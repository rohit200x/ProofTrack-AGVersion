"""Organization settings & storage maintenance endpoints."""

from datetime import timedelta

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.security.deps import AuthContext, auth_ctx, require_admin
from app.services import delivery as delivery_service
from app.services import settings as settings_service
from app.storage.base import get_storage

router = APIRouter(prefix="/api/v1/settings", tags=["Settings"])


class SettingsUpdateRequest(BaseModel):
    business_timezone: str | None = Field(default=None)
    proof_retention_days: int | None = Field(default=None, ge=30, le=3650)
    organization_name: str | None = Field(default=None, min_length=1, max_length=120)


@router.get("")
def get_settings_endpoint(ctx: AuthContext = Depends(auth_ctx), db: Session = Depends(get_db)):
    return settings_service.get_all(db)


@router.patch("")
def update_settings_endpoint(
    body: SettingsUpdateRequest,
    ctx: AuthContext = Depends(require_admin),
    db: Session = Depends(get_db),
):
    return settings_service.update(
        db,
        body.model_dump(exclude_unset=True),
        actor_id=ctx.user.id,
        ip=ctx.ip,
    )


@router.post("/reconcile-storage")
def reconcile_storage_endpoint(
    ctx: AuthContext = Depends(require_admin),
    db: Session = Depends(get_db),
):
    return delivery_service.reconcile_orphans(db, get_storage(), older_than=timedelta(seconds=0))
