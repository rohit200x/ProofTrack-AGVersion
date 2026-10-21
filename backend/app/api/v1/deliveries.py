"""Delivery CRUD, workflow, CSV import/export endpoints."""

import csv
import io
import math
import uuid
from datetime import date
from decimal import Decimal, InvalidOperation

from fastapi import APIRouter, Body, Depends, File, Form, Query, UploadFile
from sqlalchemy.orm import Session
from starlette.responses import StreamingResponse

from app.core.errors import Forbidden, ValidationFailed, field_error
from app.db.session import get_db
from app.models.enums import Role
from app.schemas.common import Page
from app.schemas.delivery import (
    AssignDriverRequest,
    CancelDeliveryRequest,
    CreateDeliveryRequest,
    DeliveryEventResponse,
    DeliveryResponse,
    ProofResponse,
    ReopenDeliveryRequest,
    UpdateDeliveryRequest,
)
from app.security.deps import AuthContext, auth_ctx, require_driver, require_manager
from app.services import delivery as delivery_service
from app.services import settings as settings_service
from app.services.csv_io import get_template_csv, import_csv
from app.services.images import process_upload
from app.storage.base import get_storage

router = APIRouter(prefix="/api/v1/deliveries", tags=["Deliveries"])


def _delivery_response(d) -> DeliveryResponse:
    return DeliveryResponse.model_validate(d)


@router.get("", response_model=Page[DeliveryResponse])
def list_deliveries(
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    status: str | None = None,
    driver_id: uuid.UUID | None = None,
    unassigned: bool = False,
    date_from: date | None = None,
    date_to: date | None = None,
    search: str | None = None,
    has_proof: bool | None = None,
    overdue: bool = False,
    flagged: bool = False,
    sort_field: str | None = None,
    sort_dir: str | None = None,
    ctx: AuthContext = Depends(require_manager),
    db: Session = Depends(get_db),
):
    overdue_before = settings_service.business_today(db) if overdue else None
    items, total = delivery_service.list_deliveries(
        db,
        page=page,
        page_size=page_size,
        status=status,
        driver_id=driver_id,
        unassigned=unassigned,
        date_from=date_from,
        date_to=date_to,
        search=search,
        has_proof=has_proof,
        overdue_before=overdue_before,
        flagged=flagged,
        sort_field=sort_field,
        sort_dir=sort_dir,
    )
    return Page(
        items=[_delivery_response(d) for d in items],
        total=total,
        page=page,
        page_size=page_size,
        pages=math.ceil(total / page_size) if total else 0,
    )


@router.post("", response_model=DeliveryResponse, status_code=201)
def create_delivery(
    body: CreateDeliveryRequest,
    ctx: AuthContext = Depends(require_manager),
    db: Session = Depends(get_db),
):
    d = delivery_service.create_delivery(db, data=body.model_dump(exclude_unset=True), actor_id=ctx.user.id)
    return _delivery_response(d)


@router.get("/export")
def export_deliveries(
    status: str | None = None,
    driver_id: uuid.UUID | None = None,
    unassigned: bool = False,
    date_from: date | None = None,
    date_to: date | None = None,
    search: str | None = None,
    has_proof: bool | None = None,
    overdue: bool = False,
    flagged: bool = False,
    ctx: AuthContext = Depends(require_manager),
    db: Session = Depends(get_db),
):
    overdue_before = settings_service.business_today(db) if overdue else None
    items = delivery_service.iter_deliveries_for_export(
        db,
        status=status,
        driver_id=driver_id,
        unassigned=unassigned,
        date_from=date_from,
        date_to=date_to,
        search=search,
        has_proof=has_proof,
        overdue_before=overdue_before,
        flagged=flagged,
    )
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow([
        "Reference",
        "External Order Ref",
        "Recipient",
        "Recipient Phone",
        "Address Line 1",
        "Address Line 2",
        "City",
        "State",
        "ZIP",
        "Status",
        "Assigned Driver",
        "Scheduled Date",
        "Window Start",
        "Window End",
        "Recipient Confirmed",
        "Failure Reason",
        "Assigned At",
        "Started At",
        "Delivered At",
        "Attempted At",
        "Created At",
    ])
    for d in items:
        driver_name = d.assigned_driver.full_name if d.assigned_driver else ""
        writer.writerow([
            d.reference,
            d.external_order_ref or "",
            d.recipient_name,
            d.recipient_phone or "",
            d.address_line1,
            d.address_line2 or "",
            d.city,
            d.state,
            d.zip_code,
            d.status,
            driver_name,
            str(d.scheduled_date),
            str(d.time_window_start or ""),
            str(d.time_window_end or ""),
            d.recipient_name_confirmed or "",
            d.failure_reason or "",
            d.assigned_at.isoformat() if d.assigned_at else "",
            d.started_at.isoformat() if d.started_at else "",
            d.delivered_at.isoformat() if d.delivered_at else "",
            d.attempted_at.isoformat() if d.attempted_at else "",
            d.created_at.isoformat() if d.created_at else "",
        ])
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=deliveries_export.csv"},
    )


@router.get("/import-template")
def import_template(ctx: AuthContext = Depends(require_manager)):
    content = get_template_csv()
    return StreamingResponse(
        iter([content]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=delivery_import_template.csv"},
    )


@router.post("/import")
async def import_deliveries(
    file: UploadFile = File(...),
    dry_run: bool = Query(False),
    allow_partial: bool = Query(False),
    ctx: AuthContext = Depends(require_manager),
    db: Session = Depends(get_db),
):
    contents = await file.read()
    return import_csv(db, contents, ctx.user.id, dry_run=dry_run, allow_partial=allow_partial)


@router.get("/{delivery_id}", response_model=DeliveryResponse)
def get_delivery(
    delivery_id: uuid.UUID,
    ctx: AuthContext = Depends(auth_ctx),
    db: Session = Depends(get_db),
):
    d = delivery_service.load_delivery(db, delivery_id)
    if ctx.user.role == Role.DRIVER and d.assigned_driver_id != ctx.user.id:
        raise Forbidden("This delivery is not assigned to you.")
    return _delivery_response(d)


@router.patch("/{delivery_id}", response_model=DeliveryResponse)
def update_delivery(
    delivery_id: uuid.UUID,
    body: UpdateDeliveryRequest,
    ctx: AuthContext = Depends(require_manager),
    db: Session = Depends(get_db),
):
    d = delivery_service.update_delivery(
        db, delivery_id, data=body.model_dump(exclude_unset=True), actor_id=ctx.user.id
    )
    return _delivery_response(d)


@router.post("/{delivery_id}/assign", response_model=DeliveryResponse)
def assign_driver(
    delivery_id: uuid.UUID,
    body: AssignDriverRequest,
    ctx: AuthContext = Depends(require_manager),
    db: Session = Depends(get_db),
):
    d = delivery_service.assign_driver(
        db,
        delivery_id,
        driver_id=body.driver_id,
        actor_id=ctx.user.id,
        scheduled_date=body.scheduled_date,
        reason=body.reason,
    )
    return _delivery_response(d)


@router.post("/{delivery_id}/unassign", response_model=DeliveryResponse)
def unassign_driver(
    delivery_id: uuid.UUID,
    ctx: AuthContext = Depends(require_manager),
    db: Session = Depends(get_db),
):
    d = delivery_service.unassign_driver(db, delivery_id, actor_id=ctx.user.id)
    return _delivery_response(d)


@router.post("/{delivery_id}/start", response_model=DeliveryResponse)
def start_delivery(
    delivery_id: uuid.UUID,
    ctx: AuthContext = Depends(require_driver),
    db: Session = Depends(get_db),
):
    d = delivery_service.start_delivery(db, delivery_id, driver_id=ctx.user.id)
    return _delivery_response(d)


def _parse_decimal(value: str | None, field: str) -> Decimal | None:
    if value is None or not str(value).strip():
        return None
    try:
        return Decimal(str(value).strip())
    except InvalidOperation:
        raise ValidationFailed(f"Invalid numeric value for {field}.", details=[field_error(field, "Invalid number.")]) from None


@router.post("/{delivery_id}/complete", response_model=DeliveryResponse)
async def complete_delivery(
    delivery_id: uuid.UUID,
    images: list[UploadFile] = File(default=[]),
    idempotency_key: str = Form(default=""),
    recipient_name: str | None = Form(None),
    driver_notes: str | None = Form(None),
    latitude: str | None = Form(None),
    longitude: str | None = Form(None),
    location_accuracy_m: str | None = Form(None),
    location_consent: bool = Form(False),
    ctx: AuthContext = Depends(require_driver),
    db: Session = Depends(get_db),
):
    if not images:
        raise ValidationFailed(
            "At least one proof-of-delivery photo is required.",
            code="PROOF_REQUIRED",
            details=[field_error("images", "Take or choose at least one photo.")],
        )
    processed = []
    try:
        for img in images:
            processed.append(process_upload(img))
        d = delivery_service.complete_delivery(
            db,
            delivery_id,
            driver_id=ctx.user.id,
            storage=get_storage(),
            images=processed,
            idempotency_key=idempotency_key,
            recipient_name=recipient_name,
            driver_notes=driver_notes,
            latitude=_parse_decimal(latitude, "latitude"),
            longitude=_parse_decimal(longitude, "longitude"),
            location_accuracy_m=_parse_decimal(location_accuracy_m, "location_accuracy_m"),
            location_consent=location_consent,
        )
        return _delivery_response(d)
    finally:
        for p in processed:
            p.close()


@router.post("/{delivery_id}/fail", response_model=DeliveryResponse)
async def fail_delivery(
    delivery_id: uuid.UUID,
    reason: str = Form(...),
    notes: str | None = Form(None),
    idempotency_key: str | None = Form(None),
    image: UploadFile | None = File(None),
    ctx: AuthContext = Depends(require_driver),
    db: Session = Depends(get_db),
):
    processed_img = None
    try:
        if image and image.filename:
            processed_img = process_upload(image)
        d = delivery_service.fail_delivery(
            db,
            delivery_id,
            driver_id=ctx.user.id,
            reason=reason,
            notes=notes,
            storage=get_storage() if processed_img else None,
            image=processed_img,
            idempotency_key=idempotency_key,
        )
        return _delivery_response(d)
    finally:
        if processed_img:
            processed_img.close()


@router.post("/{delivery_id}/reopen", response_model=DeliveryResponse)
def reopen_delivery(
    delivery_id: uuid.UUID,
    body: ReopenDeliveryRequest,
    ctx: AuthContext = Depends(require_manager),
    db: Session = Depends(get_db),
):
    d = delivery_service.reopen_delivery(
        db,
        delivery_id,
        actor_id=ctx.user.id,
        reason=body.reason,
        driver_id=body.driver_id,
        scheduled_date=body.scheduled_date,
    )
    return _delivery_response(d)


@router.post("/{delivery_id}/cancel", response_model=DeliveryResponse)
def cancel_delivery(
    delivery_id: uuid.UUID,
    body: CancelDeliveryRequest | None = Body(default=None),
    ctx: AuthContext = Depends(require_manager),
    db: Session = Depends(get_db),
):
    d = delivery_service.cancel_delivery(
        db, delivery_id, actor_id=ctx.user.id, reason=body.reason if body else None
    )
    return _delivery_response(d)


@router.get("/{delivery_id}/events", response_model=list[DeliveryEventResponse])
def delivery_events(
    delivery_id: uuid.UUID,
    ctx: AuthContext = Depends(auth_ctx),
    db: Session = Depends(get_db),
):
    d = delivery_service.get_delivery(db, delivery_id)
    if ctx.user.role == Role.DRIVER and d.assigned_driver_id != ctx.user.id:
        raise Forbidden("This delivery is not assigned to you.")
    events = delivery_service.list_events(db, delivery_id)
    if ctx.user.role == Role.DRIVER:
        events = [e for e in events if e.event_type in delivery_service.DRIVER_VISIBLE_EVENTS]
    return [DeliveryEventResponse.model_validate(e) for e in events]


@router.get("/{delivery_id}/proofs", response_model=list[ProofResponse])
def delivery_proofs(
    delivery_id: uuid.UUID,
    ctx: AuthContext = Depends(auth_ctx),
    db: Session = Depends(get_db),
):
    d = delivery_service.get_delivery(db, delivery_id)
    if ctx.user.role == Role.DRIVER and d.assigned_driver_id != ctx.user.id:
        raise Forbidden("This delivery is not assigned to you.")
    proofs = delivery_service.list_proofs(db, delivery_id)
    return [ProofResponse.model_validate(p) for p in proofs]
