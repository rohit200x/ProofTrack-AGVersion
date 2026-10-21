"""CSV bulk import & export helpers for deliveries."""

import csv
import io
import logging
import re
import uuid
from datetime import date, time

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import ValidationFailed
from app.models import User
from app.models.delivery import Delivery
from app.models.enums import DeliveryStatus, EventType, Role
from app.schemas.common import US_STATES, normalize_us_phone
from app.services.delivery import _add_event, _unique_reference
from app.utils.common import utcnow

log = logging.getLogger("prooftrack.csv")

REQUIRED = {"recipient_name", "address_line1", "city", "state", "zip_code", "scheduled_date"}
TEMPLATE_HEADERS = [
    "reference",
    "recipient_name",
    "recipient_phone",
    "address_line1",
    "address_line2",
    "city",
    "state",
    "zip_code",
    "scheduled_date",
    "time_window_start",
    "time_window_end",
    "instructions",
    "external_order_ref",
    "driver_email",
]


def get_template_csv() -> str:
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(TEMPLATE_HEADERS)
    today_str = date.today().isoformat()
    writer.writerow([
        "",
        "Jane Doe",
        "+15552345678",
        "123 Congress Ave",
        "Suite 400",
        "Austin",
        "TX",
        "78701",
        today_str,
        "09:00",
        "12:00",
        "Leave with front desk reception",
        "ORD-10045",
        "driver1@prooftrack.test",
    ])
    return buf.getvalue()


def import_csv(
    db: Session,
    file_bytes: bytes,
    actor_id: uuid.UUID,
    *,
    dry_run: bool = False,
    allow_partial: bool = False,
) -> dict:
    """Parse, validate, and transactionally import a CSV of deliveries."""
    if not file_bytes:
        raise ValidationFailed("CSV file is empty.")
    try:
        text = file_bytes.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise ValidationFailed("CSV file must be UTF-8 encoded.") from None

    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise ValidationFailed("CSV file appears empty or has no header row.")

    headers = [h.strip().lower().replace(" ", "_") for h in reader.fieldnames if h]
    missing = REQUIRED - set(headers)
    if missing:
        raise ValidationFailed(f"Missing required columns: {', '.join(sorted(missing))}")

    rows = list(reader)
    if not rows:
        raise ValidationFailed("CSV file contains no data rows.")
    if len(rows) > 5000:
        raise ValidationFailed("CSV import is limited to 5,000 rows per file.")

    errors: list[dict] = []
    preview_rows: list[dict] = []
    prepared: list[dict] = []
    seen_refs: set[str] = set()

    for i, raw_row in enumerate(rows, start=2):
        row_errors: list[str] = []
        norm = {
            (k.strip().lower().replace(" ", "_") if k else ""): (v.strip() if v else "")
            for k, v in raw_row.items()
            if k is not None
        }

        for req_field in sorted(REQUIRED):
            if not norm.get(req_field):
                row_errors.append(f"Missing required field '{req_field}'")

        state = norm.get("state", "").upper()
        if state and state not in US_STATES:
            row_errors.append(f"Invalid two-letter US state code '{state}'")

        zip_code = norm.get("zip_code", "")
        if zip_code and not re.fullmatch(r"\d{5}(-\d{4})?", zip_code):
            row_errors.append(f"Invalid ZIP code '{zip_code}' (use 12345 or 12345-6789)")

        sched_date = None
        if norm.get("scheduled_date"):
            try:
                sched_date = date.fromisoformat(norm["scheduled_date"])
            except ValueError:
                row_errors.append(f"Invalid scheduled_date '{norm['scheduled_date']}' (use YYYY-MM-DD)")

        phone = None
        if norm.get("recipient_phone"):
            try:
                phone = normalize_us_phone(norm["recipient_phone"])
            except ValueError as exc:
                row_errors.append(str(exc))

        tw_start, start_err = _parse_time(norm.get("time_window_start"), "time_window_start")
        tw_end, end_err = _parse_time(norm.get("time_window_end"), "time_window_end")
        if start_err:
            row_errors.append(start_err)
        if end_err:
            row_errors.append(end_err)
        if tw_start and tw_end and tw_end <= tw_start:
            row_errors.append("time_window_end must be later than time_window_start")

        ref = norm.get("reference", "").strip().upper()
        if ref:
            if ref in seen_refs:
                row_errors.append(f"Duplicate reference in CSV: '{ref}'")
            elif db.scalar(select(func.count()).select_from(Delivery).where(Delivery.reference == ref)):
                row_errors.append(f"Reference already exists in database: '{ref}'")
            seen_refs.add(ref)

        driver = None
        driver_email = norm.get("driver_email", "").strip().lower()
        if driver_email:
            driver = db.scalar(select(User).where(User.email == driver_email, User.role == Role.DRIVER.value))
            if not driver:
                row_errors.append(f"Driver not found: '{driver_email}'")
            elif not driver.is_active:
                row_errors.append(f"Driver account is inactive: '{driver_email}'")

        preview_item = {
            "row": i,
            "reference": ref or "(auto)",
            "recipient_name": norm.get("recipient_name", ""),
            "address_line1": norm.get("address_line1", ""),
            "city": norm.get("city", ""),
            "state": state,
            "zip_code": zip_code,
            "scheduled_date": norm.get("scheduled_date", ""),
            "driver_email": driver_email or None,
            "valid": len(row_errors) == 0,
            "errors": row_errors,
        }
        preview_rows.append(preview_item)

        if row_errors:
            errors.append({"row": i, "reference": ref or None, "errors": row_errors})
            continue

        prepared.append({
            "reference": ref,
            "external_order_ref": norm.get("external_order_ref") or None,
            "recipient_name": norm["recipient_name"],
            "recipient_phone": phone,
            "address_line1": norm["address_line1"],
            "address_line2": norm.get("address_line2") or None,
            "city": norm["city"],
            "state": state,
            "zip_code": zip_code,
            "scheduled_date": sched_date,
            "time_window_start": tw_start,
            "time_window_end": tw_end,
            "instructions": norm.get("instructions") or None,
            "driver": driver,
        })

    if dry_run:
        return {
            "dry_run": True,
            "created": 0,
            "valid_rows": len(prepared),
            "invalid_rows": len(errors),
            "total_rows": len(rows),
            "columns": headers,
            "errors": errors,
            "preview": preview_rows[:100],
        }

    if errors and not allow_partial:
        db.rollback()
        return {
            "dry_run": False,
            "created": 0,
            "valid_rows": len(prepared),
            "invalid_rows": len(errors),
            "total_rows": len(rows),
            "columns": headers,
            "errors": errors,
            "preview": preview_rows[:100],
        }

    now = utcnow()
    created_refs: list[str] = []
    for item in prepared:
        ref = item["reference"] or _unique_reference(db)
        drv: User | None = item["driver"]
        status = DeliveryStatus.ASSIGNED.value if drv else DeliveryStatus.PENDING.value
        delivery_id = uuid.uuid4()
        delivery = Delivery(
            id=delivery_id,
            reference=ref,
            external_order_ref=item["external_order_ref"],
            recipient_name=item["recipient_name"],
            recipient_phone=item["recipient_phone"],
            address_line1=item["address_line1"],
            address_line2=item["address_line2"],
            city=item["city"],
            state=item["state"],
            zip_code=item["zip_code"],
            country="US",
            scheduled_date=item["scheduled_date"],
            time_window_start=item["time_window_start"],
            time_window_end=item["time_window_end"],
            instructions=item["instructions"],
            assigned_driver_id=drv.id if drv else None,
            assigned_at=now if drv else None,
            status=status,
            created_by_id=actor_id,
            version=1,
        )
        db.add(delivery)
        db.flush()
        _add_event(db, delivery_id, EventType.IMPORTED, actor_id, to_status=DeliveryStatus.PENDING)
        if drv:
            _add_event(
                db,
                delivery_id,
                EventType.ASSIGNED,
                actor_id,
                from_status=DeliveryStatus.PENDING,
                to_status=DeliveryStatus.ASSIGNED,
                details={"driver_id": str(drv.id), "driver_name": drv.full_name},
            )
        created_refs.append(ref)

    if prepared:
        db.commit()

    return {
        "dry_run": False,
        "created": len(created_refs),
        "created_references": created_refs,
        "valid_rows": len(prepared),
        "invalid_rows": len(errors),
        "total_rows": len(rows),
        "columns": headers,
        "errors": errors,
        "preview": preview_rows[:100],
    }


def _parse_time(val: str | None, field_name: str) -> tuple[time | None, str | None]:
    if not val:
        return None, None
    try:
        parts = val.split(":")
        return time(int(parts[0]), int(parts[1]) if len(parts) > 1 else 0), None
    except (ValueError, IndexError):
        return None, f"Invalid {field_name} '{val}' (use HH:MM)"
