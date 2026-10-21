"""Organisation-level operational settings stored in application_settings."""

import uuid
from datetime import date, datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError, available_timezones

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import ValidationFailed, field_error
from app.models.ops import ApplicationSetting
from app.services.auth import audit
from app.utils.common import utcnow

US_TIMEZONES = [
    "America/New_York", "America/Detroit", "America/Indiana/Indianapolis", "America/Chicago",
    "America/Denver", "America/Phoenix", "America/Boise", "America/Los_Angeles", "America/Anchorage",
    "Pacific/Honolulu", "America/Puerto_Rico",
]


def get_all(db: Session) -> dict:
    s = get_settings()
    values = {
        "business_timezone": s.business_timezone,
        "proof_retention_days": s.proof_retention_days,
        "organization_name": s.organization_name,
    }
    for row in db.scalars(select(ApplicationSetting)):
        values[row.key] = row.value
    values["max_upload_mb"] = s.max_upload_mb
    values["max_proof_photos"] = s.max_proof_photos
    values["supported_timezones"] = US_TIMEZONES
    return values


def business_tz(db: Session) -> ZoneInfo:
    row = db.get(ApplicationSetting, "business_timezone")
    name = row.value if row else get_settings().business_timezone
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo("America/Chicago")


def business_today(db: Session) -> date:
    return datetime.now(business_tz(db)).date()


def update(db: Session, updates: dict, *, actor_id: uuid.UUID, ip: str | None) -> dict:
    allowed = {"business_timezone", "proof_retention_days", "organization_name"}
    changes = {}
    for key, value in updates.items():
        if key not in allowed or value is None:
            continue
        if key == "business_timezone" and value not in available_timezones():
            raise ValidationFailed("Unknown timezone.", details=[field_error(key, "Unknown timezone.")])
        if key == "proof_retention_days" and not (30 <= int(value) <= 3650):
            raise ValidationFailed("Retention must be between 30 and 3650 days.",
                                   details=[field_error(key, "Must be between 30 and 3650 days.")])
        if key == "organization_name" and not (1 <= len(str(value).strip()) <= 120):
            raise ValidationFailed("Organization name is required.", details=[field_error(key, "Required.")])
        row = db.get(ApplicationSetting, key)
        old = row.value if row else None
        if row is None:
            db.add(ApplicationSetting(key=key, value=value, updated_by_id=actor_id))
        else:
            row.value = value
            row.updated_by_id = actor_id
            row.updated_at = utcnow()
        changes[key] = {"from": old, "to": value}
    if changes:
        audit(db, "settings.updated", actor_id=actor_id, entity_type="settings", ip=ip, changes=changes)
        db.commit()
    return get_all(db)
