"""Delivery lifecycle: CRUD, assignment, the central status state machine, the event log,
proof-of-delivery completion and proof management.

Critical invariant: a delivery only becomes DELIVERED inside the same database transaction that
inserts at least one DELIVERY proof row, and only after every proof object has been written to
object storage successfully. PostgreSQL re-checks this with a deferred constraint trigger.
"""

from __future__ import annotations

import hashlib
import logging
import secrets
import uuid
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal
from typing import BinaryIO

from sqlalchemy import and_, case, exists, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.core.errors import (
    Conflict,
    Forbidden,
    InvalidTransition,
    NotFound,
    ServiceUnavailable,
    ValidationFailed,
    field_error,
)
from app.core.config import get_settings
from app.models import User
from app.models.delivery import Delivery, DeliveryEvent, DeliveryProof
from app.models.enums import (
    DeliveryStatus,
    EventType,
    FailureReason,
    ProofKind,
    ProofReviewStatus,
    Role,
    UploadAction,
    UploadStatus,
)
from app.models.ops import UploadRequest
from app.services.auth import audit
from app.services.images import ProcessedImage
from app.storage.base import ObjectStorage, StorageError
from app.utils.common import utcnow

log = logging.getLogger("prooftrack.delivery")

S = DeliveryStatus
ACTIVE = (S.ASSIGNED, S.IN_TRANSIT)
OPEN = (S.PENDING, S.ASSIGNED, S.IN_TRANSIT)
FINAL = (S.DELIVERED, S.CANCELED)
IN_PROGRESS_STALE_AFTER = timedelta(minutes=2)

# ---------------------------------------------------------------------------
# State machine
# ---------------------------------------------------------------------------

TRANSITIONS: dict[DeliveryStatus, set[DeliveryStatus]] = {
    S.PENDING: {S.ASSIGNED, S.CANCELED},
    S.ASSIGNED: {S.IN_TRANSIT, S.DELIVERED, S.FAILED, S.PENDING, S.CANCELED},
    S.IN_TRANSIT: {S.DELIVERED, S.FAILED, S.CANCELED},
    S.FAILED: {S.ASSIGNED, S.CANCELED},
    S.DELIVERED: set(),
    S.CANCELED: set(),
}
# Exceptional manager corrections (require a reason; recorded as REOPENED events).
REOPEN_FROM = {S.DELIVERED, S.FAILED, S.CANCELED}


def can_transition(from_status: str, to_status: str) -> bool:
    try:
        return DeliveryStatus(to_status) in TRANSITIONS[DeliveryStatus(from_status)]
    except (KeyError, ValueError):
        return False


def _transition(delivery: Delivery, to_status: DeliveryStatus) -> str:
    old = delivery.status
    if not can_transition(old, to_status):
        raise InvalidTransition(
            f"A delivery cannot move from {old.replace('_', ' ')} to {to_status.value.replace('_', ' ')}."
        )
    delivery.status = to_status.value
    return old


# ---------------------------------------------------------------------------
# References
# ---------------------------------------------------------------------------

_REF_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"  # no 0/O/1/I/L ambiguity


def generate_reference() -> str:
    body = "".join(secrets.choice(_REF_ALPHABET) for _ in range(8))
    return f"PT-{body[:4]}-{body[4:]}"  # 31^8 ≈ 8.5e11 combinations


def _unique_reference(db: Session) -> str:
    for _ in range(10):
        ref = generate_reference()
        if not db.scalar(select(exists().where(Delivery.reference == ref))):
            return ref
    raise RuntimeError("Could not generate a unique delivery reference")


# ---------------------------------------------------------------------------
# Queries
# ---------------------------------------------------------------------------


def _proof_count_col():
    return (
        select(func.count(DeliveryProof.id))
        .where(
            DeliveryProof.delivery_id == Delivery.id,
            DeliveryProof.kind == ProofKind.DELIVERY.value,
            DeliveryProof.deleted_at.is_(None),
        )
        .correlate(Delivery)
        .scalar_subquery()
        .label("proof_count")
    )


def _flagged_col():
    return (
        select(func.count(DeliveryProof.id))
        .where(
            DeliveryProof.delivery_id == Delivery.id,
            DeliveryProof.review_status == ProofReviewStatus.FLAGGED.value,
            DeliveryProof.deleted_at.is_(None),
        )
        .correlate(Delivery)
        .scalar_subquery()
        .label("flagged_count")
    )


def _base_query():
    return select(Delivery, _proof_count_col(), _flagged_col()).options(joinedload(Delivery.assigned_driver))


def _hydrate(rows) -> list[Delivery]:
    out = []
    for d, pc, fc in rows:
        d.proof_count = pc or 0
        d.flagged_count = fc or 0
        out.append(d)
    return out


def load_delivery(db: Session, delivery_id: uuid.UUID) -> Delivery:
    """Delivery with driver, proof count and flag count populated (for API responses)."""
    row = db.execute(
        _base_query().where(Delivery.id == delivery_id).execution_options(populate_existing=True)
    ).first()
    if not row:
        raise NotFound("Delivery not found.")
    return _hydrate([row])[0]


def get_delivery(db: Session, delivery_id: uuid.UUID, *, for_update: bool = False, **_ignored) -> Delivery:
    q = select(Delivery).where(Delivery.id == delivery_id).execution_options(populate_existing=True)
    if for_update:
        q = q.with_for_update()
    d = db.scalar(q)
    if not d:
        raise NotFound("Delivery not found.")
    return d


def _apply_filters(q, *, status=None, driver_id=None, unassigned=False, date_from=None, date_to=None, search=None,
                   has_proof=None, overdue_before: date | None = None, flagged=None):
    if status:
        statuses = [s.strip().upper() for s in status.split(",") if s.strip()]
        q = q.where(Delivery.status.in_(statuses))
    if driver_id:
        q = q.where(Delivery.assigned_driver_id == driver_id)
    if unassigned:
        q = q.where(Delivery.assigned_driver_id.is_(None))
    if date_from:
        q = q.where(Delivery.scheduled_date >= date_from)
    if date_to:
        q = q.where(Delivery.scheduled_date <= date_to)
    if search and search.strip():
        pat = f"%{search.strip()[:100]}%"
        q = q.where(
            or_(
                Delivery.reference.ilike(pat),
                Delivery.external_order_ref.ilike(pat),
                Delivery.recipient_name.ilike(pat),
                Delivery.address_line1.ilike(pat),
                Delivery.city.ilike(pat),
                Delivery.zip_code.ilike(pat),
            )
        )
    proof_exists = exists().where(
        DeliveryProof.delivery_id == Delivery.id,
        DeliveryProof.kind == ProofKind.DELIVERY.value,
        DeliveryProof.deleted_at.is_(None),
    )
    if has_proof is True:
        q = q.where(proof_exists)
    elif has_proof is False:
        q = q.where(~proof_exists)
    if overdue_before:
        q = q.where(Delivery.scheduled_date < overdue_before, Delivery.status.in_([s.value for s in OPEN]))
    if flagged:
        q = q.where(
            exists().where(
                DeliveryProof.delivery_id == Delivery.id,
                DeliveryProof.review_status == ProofReviewStatus.FLAGGED.value,
                DeliveryProof.deleted_at.is_(None),
            )
        )
    return q


SORTABLE = {
    "reference": Delivery.reference,
    "recipient_name": Delivery.recipient_name,
    "scheduled_date": Delivery.scheduled_date,
    "status": Delivery.status,
    "updated_at": Delivery.updated_at,
    "created_at": Delivery.created_at,
    "delivered_at": Delivery.delivered_at,
    "city": Delivery.city,
}


def list_deliveries(db: Session, *, page: int = 1, page_size: int = 25, sort_field: str | None = None,
                    sort_dir: str | None = None, **filters) -> tuple[list[Delivery], int]:
    count_q = _apply_filters(select(func.count(Delivery.id)), **filters)
    total = db.scalar(count_q) or 0
    q = _apply_filters(_base_query(), **filters)
    col = SORTABLE.get(sort_field or "", Delivery.updated_at)
    q = q.order_by(col.asc() if sort_dir == "asc" else col.desc().nulls_last(), Delivery.id)
    q = q.offset((page - 1) * page_size).limit(page_size)
    return _hydrate(db.execute(q).unique().all()), total


def iter_deliveries_for_export(db: Session, *, limit: int = 50000, **filters) -> Iterable[Delivery]:
    q = _apply_filters(select(Delivery).options(joinedload(Delivery.assigned_driver)), **filters)
    q = q.order_by(Delivery.scheduled_date.desc(), Delivery.reference).limit(limit)
    return db.scalars(q).unique()


_STATUS_ORDER = case(
    (Delivery.status == S.IN_TRANSIT.value, 0),
    (Delivery.status == S.ASSIGNED.value, 1),
    (Delivery.status == S.FAILED.value, 2),
    (Delivery.status == S.DELIVERED.value, 3),
    else_=4,
)


def driver_deliveries(db: Session, driver_id: uuid.UUID, *, date_filter: date | None = None, status: str | None = None,
                      search: str | None = None, include_overdue: bool = True) -> list[Delivery]:
    q = _base_query().where(Delivery.assigned_driver_id == driver_id)
    if date_filter:
        cond = Delivery.scheduled_date == date_filter
        if include_overdue:
            # Unfinished work from earlier days stays on the driver's list until it is resolved.
            cond = or_(cond, and_(Delivery.scheduled_date < date_filter, Delivery.status.in_([s.value for s in ACTIVE])))
        q = q.where(cond)
    q = _apply_filters(q, status=status, search=search)
    q = q.order_by(_STATUS_ORDER, Delivery.scheduled_date, Delivery.time_window_start.asc().nulls_last(), Delivery.reference)
    return _hydrate(db.execute(q).unique().all())


def driver_history(db: Session, driver_id: uuid.UUID, *, page: int = 1, page_size: int = 25) -> tuple[list[Delivery], int]:
    cond = and_(Delivery.assigned_driver_id == driver_id, Delivery.status.in_([S.DELIVERED.value, S.FAILED.value]))
    total = db.scalar(select(func.count(Delivery.id)).where(cond)) or 0
    q = (
        _base_query().where(cond)
        .order_by(func.coalesce(Delivery.delivered_at, Delivery.attempted_at, Delivery.updated_at).desc())
        .offset((page - 1) * page_size).limit(page_size)
    )
    return _hydrate(db.execute(q).unique().all()), total


# ---------------------------------------------------------------------------
# Create / update
# ---------------------------------------------------------------------------

EDITABLE_FIELDS = (
    "external_order_ref", "recipient_name", "recipient_phone", "address_line1", "address_line2", "city", "state",
    "zip_code", "scheduled_date", "time_window_start", "time_window_end", "instructions", "manager_notes",
)


def create_delivery(db: Session, *, data: dict, actor_id: uuid.UUID, event_type: EventType = EventType.CREATED,
                    commit: bool = True) -> Delivery:
    ref = (data.get("reference") or "").strip().upper()
    if ref:
        if db.scalar(select(exists().where(Delivery.reference == ref))):
            raise Conflict("A delivery with this reference already exists.",
                           details=[field_error("reference", "This reference is already in use.")])
    else:
        ref = _unique_reference(db)
    driver_id = data.get("assigned_driver_id")
    now = utcnow()
    delivery = Delivery(
        id=uuid.uuid4(), reference=ref, created_by_id=actor_id, status=S.PENDING.value, version=1,
        country=(data.get("country") or "US").upper(),
        **{f: data.get(f) for f in EDITABLE_FIELDS},
    )
    _check_window(delivery)
    db.add(delivery)
    db.flush()
    _add_event(db, delivery.id, event_type, actor_id, to_status=S.PENDING)
    if driver_id:
        driver = _validate_driver(db, driver_id)
        delivery.status = S.ASSIGNED.value
        delivery.assigned_driver_id = driver.id
        delivery.assigned_at = now
        _add_event(db, delivery.id, EventType.ASSIGNED, actor_id, from_status=S.PENDING, to_status=S.ASSIGNED,
                   details={"driver_id": str(driver.id), "driver_name": driver.full_name})
    if commit:
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            raise Conflict("A delivery with this reference already exists.",
                           details=[field_error("reference", "This reference is already in use.")]) from None
        return load_delivery(db, delivery.id)
    return delivery


def update_delivery(db: Session, delivery_id: uuid.UUID, *, data: dict, actor_id: uuid.UUID) -> Delivery:
    delivery = get_delivery(db, delivery_id, for_update=True)
    expected = data.get("version")
    if expected is not None and delivery.version != expected:
        db.rollback()
        raise Conflict("This delivery was changed by someone else. Refresh to see the latest version.",
                       code="VERSION_CONFLICT")
    if delivery.status in FINAL:
        db.rollback()
        raise Conflict(f"{delivery.status.title()} deliveries cannot be edited. Reopen it first if a correction is needed.",
                       code="DELIVERY_FINALIZED")
    changes: dict = {}
    for f in EDITABLE_FIELDS:
        if f in data and data[f] != getattr(delivery, f):
            changes[f] = {"from": _jsonable(getattr(delivery, f)), "to": _jsonable(data[f])}
            setattr(delivery, f, data[f])
    _check_window(delivery)
    if changes:
        delivery.version += 1
        delivery.updated_at = utcnow()
        _add_event(db, delivery.id, EventType.UPDATED, actor_id, details={"changes": changes})
        db.commit()
    else:
        db.rollback()
    return load_delivery(db, delivery_id)


# ---------------------------------------------------------------------------
# Assignment (managers)
# ---------------------------------------------------------------------------


def assign_driver(db: Session, delivery_id: uuid.UUID, *, driver_id: uuid.UUID, actor_id: uuid.UUID,
                  scheduled_date: date | None = None, reason: str | None = None) -> Delivery:
    delivery = get_delivery(db, delivery_id, for_update=True)
    driver = _validate_driver(db, driver_id)
    old_status, old_driver = delivery.status, delivery.assigned_driver_id
    if old_status == S.ASSIGNED and old_driver == driver.id and not scheduled_date:
        db.rollback()
        return load_delivery(db, delivery_id)  # idempotent
    if old_status == S.IN_TRANSIT:
        db.rollback()
        raise InvalidTransition("This delivery is already in transit. The driver must complete or fail it first.")
    if old_status in (S.PENDING, S.FAILED):
        _transition(delivery, S.ASSIGNED)
    elif old_status != S.ASSIGNED:
        db.rollback()
        raise InvalidTransition(f"Cannot assign a driver to a {old_status.lower()} delivery.")
    details = {"driver_id": str(driver.id), "driver_name": driver.full_name}
    if old_status == S.FAILED:
        details["previous_failure_reason"] = delivery.failure_reason
        delivery.failure_reason = None
        delivery.failure_notes = None
    if scheduled_date and scheduled_date != delivery.scheduled_date:
        details["rescheduled"] = {"from": str(delivery.scheduled_date), "to": str(scheduled_date)}
        delivery.scheduled_date = scheduled_date
    if old_driver and old_driver != driver.id:
        details["previous_driver_id"] = str(old_driver)
        event_type = EventType.REASSIGNED
    else:
        event_type = EventType.ASSIGNED
    delivery.assigned_driver_id = driver.id
    delivery.assigned_at = utcnow()
    delivery.started_at = None
    delivery.version += 1
    _add_event(db, delivery.id, event_type, actor_id, from_status=old_status, to_status=delivery.status,
               reason=reason, details=details)
    db.commit()
    return load_delivery(db, delivery_id)


def unassign_driver(db: Session, delivery_id: uuid.UUID, *, actor_id: uuid.UUID, reason: str | None = None) -> Delivery:
    delivery = get_delivery(db, delivery_id, for_update=True)
    if delivery.status != S.ASSIGNED:
        db.rollback()
        raise InvalidTransition("Only deliveries in ASSIGNED status can be unassigned.")
    old_driver = delivery.assigned_driver_id
    _transition(delivery, S.PENDING)
    delivery.assigned_driver_id = None
    delivery.assigned_at = None
    delivery.version += 1
    _add_event(db, delivery.id, EventType.UNASSIGNED, actor_id, from_status=S.ASSIGNED, to_status=S.PENDING,
               reason=reason, details={"previous_driver_id": str(old_driver)})
    db.commit()
    return load_delivery(db, delivery_id)


# ---------------------------------------------------------------------------
# Driver actions
# ---------------------------------------------------------------------------


def start_delivery(db: Session, delivery_id: uuid.UUID, *, driver_id: uuid.UUID) -> Delivery:
    delivery = get_delivery(db, delivery_id, for_update=True)
    _assert_driver_owns(delivery, driver_id)
    if delivery.status == S.IN_TRANSIT:
        db.rollback()
        return load_delivery(db, delivery_id)  # idempotent retry
    _transition(delivery, S.IN_TRANSIT)
    delivery.started_at = utcnow()
    delivery.version += 1
    _add_event(db, delivery.id, EventType.STARTED, driver_id, from_status=S.ASSIGNED, to_status=S.IN_TRANSIT)
    db.commit()
    return load_delivery(db, delivery_id)


@dataclass
class _PlannedProof:
    proof_id: uuid.UUID
    image: ProcessedImage
    original_key: str
    preview_key: str
    thumb_key: str

    def objects(self) -> list[tuple[str, BinaryIO, str, int]]:
        img = self.image
        objs = [(self.original_key, img.original, img.content_type, img.size_bytes)]
        if img.preview is not None:
            objs.append((self.preview_key, img.preview, "image/jpeg", img.preview_size))
        objs.append((self.thumb_key, img.thumbnail, "image/jpeg", img.thumbnail_size))
        return objs

    @property
    def keys(self) -> list[str]:
        return [k for k, *_ in self.objects()]


def _plan(delivery_id: uuid.UUID, images: list[ProcessedImage]) -> list[_PlannedProof]:
    planned = []
    for img in images:
        pid = uuid.uuid4()
        base = f"proofs/{delivery_id}/{pid}"
        planned.append(_PlannedProof(pid, img, f"{base}/original.{img.extension}", f"{base}/preview.jpg", f"{base}/thumb.jpg"))
    return planned


def complete_delivery(
    db: Session, delivery_id: uuid.UUID, *, driver_id: uuid.UUID, storage: ObjectStorage,
    images: list[ProcessedImage], idempotency_key: str, recipient_name: str | None = None,
    driver_notes: str | None = None, latitude: Decimal | None = None, longitude: Decimal | None = None,
    location_accuracy_m: Decimal | None = None, location_consent: bool = False,
) -> Delivery:
    """Validate → claim idempotency key → store every object → atomically insert proofs + set DELIVERED."""
    s = get_settings()
    delivery = get_delivery(db, delivery_id)
    _assert_driver_owns(delivery, driver_id)
    if not images:
        raise ValidationFailed("At least one proof-of-delivery photo is required.", code="PROOF_REQUIRED",
                               details=[field_error("images", "Take or choose at least one photo.")])
    if len(images) > s.max_proof_photos:
        raise ValidationFailed(f"You can attach at most {s.max_proof_photos} photos.",
                               details=[field_error("images", f"Maximum {s.max_proof_photos} photos.")])
    lat, lng, acc = _validate_location(latitude, longitude, location_accuracy_m, location_consent)
    recipient_name = _clean_text(recipient_name, 200)
    driver_notes = _clean_text(driver_notes, 2000)

    fingerprint = _fingerprint(delivery_id, UploadAction.COMPLETE, [i.sha256 for i in images])
    req = _claim_upload_request(db, driver_id, idempotency_key, delivery_id, UploadAction.COMPLETE, fingerprint)
    if req is None:  # identical request already completed: replay the authoritative result
        return load_delivery(db, delivery_id)

    if delivery.status not in ACTIVE:
        _finish_request(db, req.id, UploadStatus.FAILED, "INVALID_STATE")
        raise InvalidTransition(
            f"This delivery is {delivery.status.replace('_', ' ').lower()} and can no longer be completed.")

    planned = _plan(delivery_id, images)
    keys = [k for p in planned for k in p.keys]
    _record_pending_keys(db, req.id, keys)
    _store_all(db, storage, req.id, [o for p in planned for o in p.objects()])

    try:
        d = get_delivery(db, delivery_id, for_update=True)  # serialises concurrent completions
        if d.assigned_driver_id != driver_id:
            raise Forbidden("This delivery is no longer assigned to you.")
        if d.status not in ACTIVE:
            raise InvalidTransition("This delivery was already completed or changed by another request.")
        now = utcnow()
        for p in planned:
            img = p.image
            db.add(DeliveryProof(
                id=p.proof_id, delivery_id=d.id, uploader_id=driver_id, kind=ProofKind.DELIVERY.value,
                object_key=p.original_key, thumbnail_key=p.thumb_key,
                preview_key=p.preview_key if img.preview is not None else None,
                sha256=img.sha256, content_type=img.content_type, size_bytes=img.size_bytes,
                width=img.width, height=img.height, original_filename=img.filename, uploaded_at=now,
                location_consent=bool(lat is not None), latitude=lat, longitude=lng, location_accuracy_m=acc,
            ))
        db.flush()  # proof rows exist before the status changes
        old = _transition(d, S.DELIVERED)
        d.delivered_at = now
        d.attempted_at = now
        d.recipient_name_confirmed = recipient_name
        d.driver_notes = driver_notes
        d.failure_reason = None
        d.failure_notes = None
        d.version += 1
        _add_event(db, d.id, EventType.DELIVERED, driver_id, from_status=old, to_status=S.DELIVERED,
                   details={"proof_ids": [str(p.proof_id) for p in planned], "photo_count": len(planned),
                            "recipient_name": recipient_name, "location_captured": lat is not None})
        r = db.get(UploadRequest, req.id)
        r.status = UploadStatus.COMPLETED.value
        r.completed_at = now
        r.error_code = None
        r.pending_object_keys = [k for k in (r.pending_object_keys or []) if k not in keys]
        db.commit()
    except Exception as exc:
        db.rollback()
        _cleanup_objects(db, storage, req.id, keys)
        code = getattr(exc, "code", None) or "DATABASE_ERROR"
        _finish_request(db, req.id, UploadStatus.FAILED, code)
        if isinstance(exc, (Forbidden, InvalidTransition)):
            raise
        log.exception("completion_commit_failed", extra={"delivery_id": str(delivery_id)})
        raise ServiceUnavailable(
            "The delivery could not be saved. It has NOT been marked delivered. Please retry.",
            code="COMPLETION_NOT_SAVED") from exc
    log.info("delivery_completed", extra={"delivery_id": str(delivery_id), "photos": len(planned)})
    return load_delivery(db, delivery_id)


def fail_delivery(
    db: Session, delivery_id: uuid.UUID, *, driver_id: uuid.UUID, reason: str, notes: str | None,
    storage: ObjectStorage | None = None, image: ProcessedImage | None = None, idempotency_key: str | None = None,
) -> Delivery:
    try:
        reason_enum = FailureReason(reason)
    except ValueError:
        raise ValidationFailed("Choose a valid failure reason.",
                               details=[field_error("reason", "Choose a valid reason.")]) from None
    notes = _clean_text(notes, 2000)
    if reason_enum == FailureReason.OTHER and not notes:
        raise ValidationFailed("Please describe what happened when choosing 'Other'.",
                               details=[field_error("notes", "Notes are required when the reason is 'Other'.")])
    delivery = get_delivery(db, delivery_id)
    _assert_driver_owns(delivery, driver_id)

    key = idempotency_key or f"auto-{uuid.uuid4()}"
    fingerprint = _fingerprint(delivery_id, UploadAction.FAIL, [image.sha256] if image else [], reason_enum.value)
    req = _claim_upload_request(db, driver_id, key, delivery_id, UploadAction.FAIL, fingerprint)
    if req is None:
        return load_delivery(db, delivery_id)
    if delivery.status not in ACTIVE:
        _finish_request(db, req.id, UploadStatus.FAILED, "INVALID_STATE")
        raise InvalidTransition(
            f"This delivery is {delivery.status.replace('_', ' ').lower()}; a failed attempt cannot be reported.")

    planned = _plan(delivery_id, [image]) if image else []
    keys = [k for p in planned for k in p.keys]
    if planned:
        if storage is None:
            raise RuntimeError("storage required for failure photo")
        _record_pending_keys(db, req.id, keys)
        _store_all(db, storage, req.id, [o for p in planned for o in p.objects()])
    try:
        d = get_delivery(db, delivery_id, for_update=True)
        if d.assigned_driver_id != driver_id:
            raise Forbidden("This delivery is no longer assigned to you.")
        if d.status not in ACTIVE:
            raise InvalidTransition("This delivery was already completed or changed by another request.")
        now = utcnow()
        for p in planned:
            img = p.image
            db.add(DeliveryProof(
                id=p.proof_id, delivery_id=d.id, uploader_id=driver_id, kind=ProofKind.FAILED_ATTEMPT.value,
                object_key=p.original_key, thumbnail_key=p.thumb_key,
                preview_key=p.preview_key if img.preview is not None else None, sha256=img.sha256,
                content_type=img.content_type, size_bytes=img.size_bytes, width=img.width, height=img.height,
                original_filename=img.filename, uploaded_at=now,
            ))
        old = _transition(d, S.FAILED)
        d.failure_reason = reason_enum.value
        d.failure_notes = notes
        d.attempted_at = now
        d.version += 1
        _add_event(db, d.id, EventType.FAILED, driver_id, from_status=old, to_status=S.FAILED, reason=notes,
                   details={"failure_reason": reason_enum.value, "photo_ids": [str(p.proof_id) for p in planned]})
        r = db.get(UploadRequest, req.id)
        r.status = UploadStatus.COMPLETED.value
        r.completed_at = now
        r.pending_object_keys = [k for k in (r.pending_object_keys or []) if k not in keys]
        db.commit()
    except Exception as exc:
        db.rollback()
        if keys and storage is not None:
            _cleanup_objects(db, storage, req.id, keys)
        _finish_request(db, req.id, UploadStatus.FAILED, getattr(exc, "code", None) or "DATABASE_ERROR")
        if isinstance(exc, (Forbidden, InvalidTransition)):
            raise
        log.exception("failure_commit_failed", extra={"delivery_id": str(delivery_id)})
        raise ServiceUnavailable("The failed attempt could not be saved. Please retry.", code="FAILURE_NOT_SAVED") from exc
    return load_delivery(db, delivery_id)


# ---------------------------------------------------------------------------
# Manager actions: cancel / reopen
# ---------------------------------------------------------------------------


def cancel_delivery(db: Session, delivery_id: uuid.UUID, *, actor_id: uuid.UUID, reason: str | None = None) -> Delivery:
    reason = _clean_text(reason, 1000) or "Canceled by management"
    delivery = get_delivery(db, delivery_id, for_update=True)
    if delivery.status in FINAL:
        db.rollback()
        raise InvalidTransition(f"A {delivery.status.lower()} delivery cannot be canceled.")
    old = _transition(delivery, S.CANCELED)
    delivery.version += 1
    _add_event(db, delivery.id, EventType.CANCELED, actor_id, from_status=old, to_status=S.CANCELED, reason=reason)
    db.commit()
    return load_delivery(db, delivery_id)


def reopen_delivery(db: Session, delivery_id: uuid.UUID, *, actor_id: uuid.UUID, reason: str,
                    driver_id: uuid.UUID | None = None, scheduled_date: date | None = None) -> Delivery:
    """Exceptional correction: move a DELIVERED/FAILED/CANCELED delivery back into the workflow.
    Proof evidence is never removed; previous completion data is preserved in the event log."""
    reason = _clean_text(reason, 1000)
    if not reason or len(reason) < 5:
        raise ValidationFailed("Explain why this delivery is being reopened (at least 5 characters).",
                               details=[field_error("reason", "A reason of at least 5 characters is required.")])
    delivery = get_delivery(db, delivery_id, for_update=True)
    old = delivery.status
    if old not in REOPEN_FROM:
        db.rollback()
        raise InvalidTransition("Only delivered, failed or canceled deliveries can be reopened.")
    details = {
        "previous": {
            "status": old, "delivered_at": _jsonable(delivery.delivered_at),
            "recipient_name_confirmed": delivery.recipient_name_confirmed,
            "failure_reason": delivery.failure_reason, "driver_id": _jsonable(delivery.assigned_driver_id),
        }
    }
    if driver_id:
        driver = _validate_driver(db, driver_id)
        delivery.status = S.ASSIGNED.value
        delivery.assigned_driver_id = driver.id
        delivery.assigned_at = utcnow()
        details["driver_id"] = str(driver.id)
        details["driver_name"] = driver.full_name
    else:
        delivery.status = S.PENDING.value
        delivery.assigned_driver_id = None
        delivery.assigned_at = None
    if scheduled_date:
        details["rescheduled"] = {"from": str(delivery.scheduled_date), "to": str(scheduled_date)}
        delivery.scheduled_date = scheduled_date
    delivery.started_at = None
    delivery.delivered_at = None
    delivery.recipient_name_confirmed = None
    delivery.failure_reason = None
    delivery.failure_notes = None
    delivery.version += 1
    _add_event(db, delivery.id, EventType.REOPENED, actor_id, from_status=old, to_status=delivery.status,
               reason=reason, details=details)
    db.commit()
    return load_delivery(db, delivery_id)


# ---------------------------------------------------------------------------
# Events and proofs
# ---------------------------------------------------------------------------

DRIVER_VISIBLE_EVENTS = {
    EventType.ASSIGNED.value, EventType.REASSIGNED.value, EventType.STARTED.value, EventType.DELIVERED.value,
    EventType.FAILED.value, EventType.CANCELED.value, EventType.REOPENED.value, EventType.UNASSIGNED.value,
}


def list_events(db: Session, delivery_id: uuid.UUID) -> list[DeliveryEvent]:
    return list(db.scalars(
        select(DeliveryEvent).options(joinedload(DeliveryEvent.actor))
        .where(DeliveryEvent.delivery_id == delivery_id)
        .order_by(DeliveryEvent.created_at.asc(), DeliveryEvent.id)
    ))


def list_proofs(db: Session, delivery_id: uuid.UUID) -> list[DeliveryProof]:
    return list(db.scalars(
        select(DeliveryProof)
        .options(joinedload(DeliveryProof.uploader), joinedload(DeliveryProof.reviewed_by))
        .where(DeliveryProof.delivery_id == delivery_id, DeliveryProof.deleted_at.is_(None))
        .order_by(DeliveryProof.uploaded_at.asc(), DeliveryProof.id)
    ))


def get_proof(db: Session, proof_id: uuid.UUID) -> DeliveryProof:
    proof = db.scalar(
        select(DeliveryProof)
        .options(joinedload(DeliveryProof.uploader), joinedload(DeliveryProof.reviewed_by))
        .where(DeliveryProof.id == proof_id, DeliveryProof.deleted_at.is_(None))
        .execution_options(populate_existing=True)
    )
    if not proof:
        raise NotFound("Proof photo not found.")
    return proof


def can_view_proof(db: Session, user: User, proof: DeliveryProof) -> bool:
    if user.role in (Role.ADMIN, Role.MANAGER):
        return True
    if proof.uploader_id == user.id:
        return True
    driver_id = db.scalar(select(Delivery.assigned_driver_id).where(Delivery.id == proof.delivery_id))
    return driver_id == user.id


def flag_proof(db: Session, proof_id: uuid.UUID, *, reason: str, actor_id: uuid.UUID) -> DeliveryProof:
    reason = _clean_text(reason, 1000)
    if not reason or len(reason) < 5:
        raise ValidationFailed("Describe why this proof needs investigation (at least 5 characters).",
                               details=[field_error("reason", "At least 5 characters.")])
    proof = get_proof(db, proof_id)
    old = proof.review_status
    proof.review_status = ProofReviewStatus.FLAGGED.value
    proof.review_reason = reason
    proof.reviewed_by_id = actor_id
    proof.reviewed_at = utcnow()
    _add_event(db, proof.delivery_id, EventType.PROOF_FLAGGED, actor_id, reason=reason,
               details={"proof_id": str(proof.id), "previous_review_status": old})
    db.commit()
    return get_proof(db, proof_id)


def resolve_proof(db: Session, proof_id: uuid.UUID, *, note: str, actor_id: uuid.UUID) -> DeliveryProof:
    note = _clean_text(note, 1000)
    if not note or len(note) < 5:
        raise ValidationFailed("Record how the investigation was resolved (at least 5 characters).",
                               details=[field_error("reason", "At least 5 characters.")])
    proof = get_proof(db, proof_id)
    if proof.review_status != ProofReviewStatus.FLAGGED:
        raise InvalidTransition("Only flagged proofs can be resolved.")
    proof.review_status = ProofReviewStatus.RESOLVED.value
    proof.review_reason = note
    proof.reviewed_by_id = actor_id
    proof.reviewed_at = utcnow()
    _add_event(db, proof.delivery_id, EventType.PROOF_REVIEW_RESOLVED, actor_id, reason=note,
               details={"proof_id": str(proof.id)})
    db.commit()
    return get_proof(db, proof_id)


def delete_proof(db: Session, proof_id: uuid.UUID, *, reason: str, actor_id: uuid.UUID, storage: ObjectStorage,
                 ip: str | None = None) -> None:
    """Administrator-only secure deletion (e.g. retention expiry or legal request). The metadata row is
    kept as a tombstone with who/when/why; the stored objects are removed."""
    reason = _clean_text(reason, 1000)
    if not reason or len(reason) < 5:
        raise ValidationFailed("A deletion reason of at least 5 characters is required.",
                               details=[field_error("reason", "At least 5 characters.")])
    proof = get_proof(db, proof_id)
    keys = [k for k in (proof.object_key, proof.preview_key, proof.thumbnail_key) if k]
    proof.deleted_at = utcnow()
    proof.deleted_by_id = actor_id
    proof.deletion_reason = reason
    _add_event(db, proof.delivery_id, EventType.PROOF_DELETED, actor_id, reason=reason,
               details={"proof_id": str(proof.id), "sha256": proof.sha256})
    audit(db, "proof.deleted", actor_id=actor_id, entity_type="proof", entity_id=str(proof.id), ip=ip, reason=reason)
    db.commit()
    for k in keys:
        try:
            storage.delete(k)
        except StorageError:
            log.warning("proof_object_delete_deferred", extra={"key": k})  # reconciliation retries


# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------

KPI_DEFINITIONS = {
    "total": "All deliveries scheduled within the selected date range (including canceled).",
    "pending": "Created but not yet assigned to a driver.",
    "assigned": "Assigned to a driver who has not started yet.",
    "in_transit": "The driver has started the delivery.",
    "delivered": "Completed with at least one stored proof-of-delivery photo.",
    "failed": "The latest delivery attempt failed and needs follow-up.",
    "canceled": "Canceled by management.",
    "overdue": "Scheduled before today (business timezone) and still pending, assigned or in transit.",
    "completion_pct": "Delivered ÷ (total − canceled) × 100.",
}


def dashboard_summary(db: Session, *, today: date, date_from: date | None = None, date_to: date | None = None) -> dict:
    conds = []
    if date_from:
        conds.append(Delivery.scheduled_date >= date_from)
    if date_to:
        conds.append(Delivery.scheduled_date <= date_to)
    rows = db.execute(select(Delivery.status, func.count(Delivery.id)).where(*conds).group_by(Delivery.status)).all()
    counts = {s.value.lower(): 0 for s in DeliveryStatus}
    for status, n in rows:
        counts[status.lower()] = n
    total = sum(counts.values())
    overdue = db.scalar(
        select(func.count(Delivery.id)).where(
            *conds, Delivery.scheduled_date < today, Delivery.status.in_([s.value for s in OPEN]))
    ) or 0
    denominator = total - counts["canceled"]
    pct = round(counts["delivered"] / denominator * 100, 1) if denominator > 0 else 0.0
    return {"total": total, **counts, "overdue": overdue, "completion_pct": pct}


def dashboard_attention(db: Session, *, today: date, limit: int = 8) -> dict:
    def q(*conds, order):
        return _hydrate(db.execute(_base_query().where(*conds).order_by(order).limit(limit)).unique().all())

    flagged = exists().where(DeliveryProof.delivery_id == Delivery.id,
                             DeliveryProof.review_status == ProofReviewStatus.FLAGGED.value,
                             DeliveryProof.deleted_at.is_(None))
    return {
        "overdue": q(Delivery.scheduled_date < today, Delivery.status.in_([s.value for s in OPEN]),
                     order=Delivery.scheduled_date.asc()),
        "recent_failures": q(Delivery.status == S.FAILED.value, order=Delivery.attempted_at.desc().nulls_last()),
        "recently_completed": q(Delivery.status == S.DELIVERED.value, order=Delivery.delivered_at.desc().nulls_last()),
        "flagged": q(flagged, order=Delivery.updated_at.desc()),
        "unassigned_today": q(Delivery.status == S.PENDING.value, Delivery.scheduled_date <= today,
                              order=Delivery.scheduled_date.asc()),
    }


def dashboard_activity(db: Session, *, limit: int = 20, offset: int = 0, event_type: str | None = None,
                       since=None) -> tuple[list[DeliveryEvent], int]:
    base = select(DeliveryEvent)
    if event_type:
        base = base.where(DeliveryEvent.event_type == event_type)
    if since:
        base = base.where(DeliveryEvent.created_at >= since)
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    events = db.scalars(
        base.options(joinedload(DeliveryEvent.actor), joinedload(DeliveryEvent.delivery))
        .order_by(DeliveryEvent.created_at.desc(), DeliveryEvent.id).offset(offset).limit(limit)
    ).unique()
    return list(events), total


# ---------------------------------------------------------------------------
# Idempotency + storage helpers
# ---------------------------------------------------------------------------


def _fingerprint(delivery_id: uuid.UUID, action: UploadAction, hashes: list[str], extra: str = "") -> str:
    material = "|".join([str(delivery_id), action.value, extra, *sorted(hashes)])
    return hashlib.sha256(material.encode()).hexdigest()


def _clean_key(key: str | None) -> str:
    key = (key or "").strip()
    if not (8 <= len(key) <= 100) or not all(c.isalnum() or c in "-_:." for c in key):
        raise ValidationFailed("A valid idempotency key is required.",
                               details=[field_error("idempotency_key", "8–100 characters: letters, digits, - _ : .")])
    return key


def _claim_upload_request(db: Session, user_id: uuid.UUID, key: str, delivery_id: uuid.UUID, action: UploadAction,
                          fingerprint: str, _retry: bool = True) -> UploadRequest | None:
    """Returns a claimed (IN_PROGRESS, committed) request, or None if an identical request already completed."""
    key = _clean_key(key)
    existing = db.scalar(
        select(UploadRequest).where(UploadRequest.user_id == user_id, UploadRequest.idempotency_key == key)
        .with_for_update().execution_options(populate_existing=True)
    )
    if existing is None:
        req = UploadRequest(id=uuid.uuid4(), user_id=user_id, idempotency_key=key, delivery_id=delivery_id,
                            action=action.value, fingerprint=fingerprint, status=UploadStatus.IN_PROGRESS.value,
                            pending_object_keys=[], attempts=1)
        db.add(req)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            if _retry:
                return _claim_upload_request(db, user_id, key, delivery_id, action, fingerprint, _retry=False)
            raise Conflict("This submission is already being processed.", code="UPLOAD_IN_PROGRESS") from None
        return req
    if existing.delivery_id != delivery_id or existing.action != action.value:
        db.rollback()
        raise Conflict("This idempotency key was already used for a different submission.", code="IDEMPOTENCY_KEY_REUSED")
    if existing.status == UploadStatus.COMPLETED:
        same = existing.fingerprint == fingerprint
        db.rollback()
        if same:
            return None
        raise Conflict("This idempotency key was already used with different photos.", code="IDEMPOTENCY_KEY_REUSED")
    if existing.status == UploadStatus.IN_PROGRESS and existing.updated_at > utcnow() - IN_PROGRESS_STALE_AFTER:
        db.rollback()
        raise Conflict("This submission is already being processed. Wait a moment, then refresh.",
                       code="UPLOAD_IN_PROGRESS")
    # FAILED (or abandoned IN_PROGRESS): retry under the same key. Earlier pending keys stay listed for reconciliation.
    existing.status = UploadStatus.IN_PROGRESS.value
    existing.fingerprint = fingerprint
    existing.attempts += 1
    existing.error_code = None
    existing.updated_at = utcnow()
    db.commit()
    return existing


def _record_pending_keys(db: Session, req_id: uuid.UUID, keys: list[str]) -> None:
    """Persist object keys BEFORE writing them so interrupted uploads can always be reconciled."""
    r = db.get(UploadRequest, req_id, populate_existing=True)
    r.pending_object_keys = list(dict.fromkeys([*(r.pending_object_keys or []), *keys]))
    r.updated_at = utcnow()
    db.commit()


def _store_all(db: Session, storage: ObjectStorage, req_id: uuid.UUID, objects: list[tuple[str, BinaryIO, str, int]]) -> None:
    written: list[str] = []
    try:
        for key, fileobj, ctype, size in objects:
            storage.put(key, fileobj, content_type=ctype, size=size)
            written.append(key)
    except StorageError as exc:
        log.error("proof_storage_failed", extra={"written": len(written), "total": len(objects)})
        _cleanup_objects(db, storage, req_id, written)
        _finish_request(db, req_id, UploadStatus.FAILED, "STORAGE_UNAVAILABLE")
        raise ServiceUnavailable(
            "Photo storage is temporarily unavailable. The delivery has NOT been completed — please retry.",
            code="STORAGE_UNAVAILABLE") from exc


def _cleanup_objects(db: Session, storage: ObjectStorage, req_id: uuid.UUID, keys: list[str]) -> None:
    removed = []
    for k in keys:
        try:
            storage.delete(k)
            removed.append(k)
        except StorageError:
            log.warning("orphan_cleanup_deferred", extra={"key": k})
    if removed:
        try:
            r = db.get(UploadRequest, req_id, populate_existing=True)
            if r is not None:
                r.pending_object_keys = [k for k in (r.pending_object_keys or []) if k not in removed]
                db.commit()
        except Exception:
            db.rollback()
            log.warning("pending_keys_update_failed", exc_info=True)


def _finish_request(db: Session, req_id: uuid.UUID, status: UploadStatus, code: str | None) -> None:
    try:
        r = db.get(UploadRequest, req_id, populate_existing=True)
        if r is not None and r.status != UploadStatus.COMPLETED:
            r.status = status.value
            r.error_code = (code or "")[:60] or None
            r.updated_at = utcnow()
            db.commit()
    except Exception:
        db.rollback()
        log.warning("upload_request_update_failed", exc_info=True)


def reconcile_orphans(db: Session, storage: ObjectStorage, *, older_than: timedelta | None = None) -> dict:
    """Delete stored objects that were written by interrupted/failed submissions and never committed as proofs,
    and finish removing objects of administratively deleted proofs."""
    grace = older_than if older_than is not None else timedelta(minutes=get_settings().orphan_grace_minutes)
    cutoff = utcnow() - grace
    stats = {"requests": 0, "deleted": 0, "kept_referenced": 0, "errors": 0, "stale_marked_failed": 0}
    reqs = db.scalars(
        select(UploadRequest).where(
            UploadRequest.updated_at < cutoff,
            or_(func.jsonb_array_length(UploadRequest.pending_object_keys) > 0,
                UploadRequest.status == UploadStatus.IN_PROGRESS.value),
        ).limit(500)
    ).all()
    for r in reqs:
        stats["requests"] += 1
        remaining = []
        for key in r.pending_object_keys or []:
            referenced = db.scalar(select(exists().where(or_(
                DeliveryProof.object_key == key, DeliveryProof.thumbnail_key == key, DeliveryProof.preview_key == key))))
            if referenced:
                stats["kept_referenced"] += 1
                continue
            try:
                storage.delete(key)
                stats["deleted"] += 1
            except StorageError:
                stats["errors"] += 1
                remaining.append(key)
        r.pending_object_keys = remaining
        if r.status == UploadStatus.IN_PROGRESS.value:
            r.status = UploadStatus.FAILED.value
            r.error_code = "ABANDONED"
            stats["stale_marked_failed"] += 1
    db.commit()
    for p in db.scalars(select(DeliveryProof).where(DeliveryProof.deleted_at.is_not(None), DeliveryProof.deleted_at < cutoff).limit(500)):
        for k in (p.object_key, p.preview_key, p.thumbnail_key):
            if k:
                try:
                    if storage.exists(k):
                        storage.delete(k)
                        stats["deleted"] += 1
                except StorageError:
                    stats["errors"] += 1
    return stats


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _validate_driver(db: Session, driver_id: uuid.UUID) -> User:
    driver = db.get(User, driver_id)
    if not driver or driver.role != Role.DRIVER:
        raise ValidationFailed("Select a valid driver.", details=[field_error("driver_id", "Not a driver account.")])
    if not driver.is_active:
        raise ValidationFailed("Inactive drivers cannot receive new assignments.",
                               details=[field_error("driver_id", "This driver account is inactive.")])
    return driver


def _assert_driver_owns(delivery: Delivery, driver_id: uuid.UUID) -> None:
    if delivery.assigned_driver_id != driver_id:
        raise Forbidden("This delivery is not assigned to you.")


def _check_window(d: Delivery) -> None:
    if d.time_window_start and d.time_window_end and d.time_window_end <= d.time_window_start:
        raise ValidationFailed("The delivery window must end after it starts.",
                               details=[field_error("time_window_end", "Must be later than the start time.")])


def _validate_location(lat, lng, acc, consent: bool):
    if lat is None and lng is None:
        return None, None, None
    if not consent:
        raise ValidationFailed("Location can only be stored with the driver's explicit consent.",
                               details=[field_error("location_consent", "Consent is required to store location.")])
    if lat is None or lng is None:
        raise ValidationFailed("Both latitude and longitude are required.")
    lat, lng = Decimal(lat), Decimal(lng)
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        raise ValidationFailed("Location coordinates are out of range.")
    acc = Decimal(acc) if acc is not None else None
    if acc is not None and not (0 <= acc < 10_000_000):
        acc = None
    return lat.quantize(Decimal("0.000001")), lng.quantize(Decimal("0.000001")), acc.quantize(Decimal("0.1")) if acc is not None else None


def _clean_text(v: str | None, max_len: int) -> str | None:
    if v is None:
        return None
    v = v.strip()
    if not v:
        return None
    if len(v) > max_len:
        raise ValidationFailed(f"Text is too long (maximum {max_len} characters).")
    return v


def _jsonable(v):
    if v is None or isinstance(v, (str, int, float, bool)):
        return v
    return str(v)


def _add_event(db: Session, delivery_id: uuid.UUID, event_type: EventType, actor_id: uuid.UUID | None, *,
               from_status: str | None = None, to_status: str | None = None, reason: str | None = None,
               details: dict | None = None) -> None:
    db.add(DeliveryEvent(
        id=uuid.uuid4(), delivery_id=delivery_id, actor_id=actor_id, event_type=event_type.value,
        from_status=str(from_status.value if hasattr(from_status, "value") else from_status) if from_status else None,
        to_status=str(to_status.value if hasattr(to_status, "value") else to_status) if to_status else None,
        reason=reason, details=details or {}, created_at=utcnow(),
    ))
