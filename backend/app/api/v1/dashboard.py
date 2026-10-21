"""Dashboard summary, attention queues, and activity endpoints."""

from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.schemas.delivery import (
    ActivityResponse,
    DashboardAttention,
    DashboardSummary,
    DeliveryEventResponse,
    DeliveryResponse,
)
from app.security.deps import AuthContext, require_manager
from app.services import delivery as delivery_service
from app.services import settings as settings_service

router = APIRouter(prefix="/api/v1/dashboard", tags=["Dashboard"])


@router.get("/summary", response_model=DashboardSummary)
def dashboard_summary(
    date_from: date | None = None,
    date_to: date | None = None,
    ctx: AuthContext = Depends(require_manager),
    db: Session = Depends(get_db),
):
    today = settings_service.business_today(db)
    tz_name = str(settings_service.business_tz(db))
    data = delivery_service.dashboard_summary(db, today=today, date_from=date_from, date_to=date_to)
    return DashboardSummary(
        **data,
        business_today=today,
        business_timezone=tz_name,
        definitions=delivery_service.KPI_DEFINITIONS,
    )


@router.get("/attention", response_model=DashboardAttention)
def dashboard_attention(
    limit: int = Query(8, ge=1, le=25),
    ctx: AuthContext = Depends(require_manager),
    db: Session = Depends(get_db),
):
    today = settings_service.business_today(db)
    buckets = delivery_service.dashboard_attention(db, today=today, limit=limit)
    return DashboardAttention(
        overdue=[DeliveryResponse.model_validate(d) for d in buckets["overdue"]],
        recent_failures=[DeliveryResponse.model_validate(d) for d in buckets["recent_failures"]],
        recently_completed=[DeliveryResponse.model_validate(d) for d in buckets["recently_completed"]],
        flagged=[DeliveryResponse.model_validate(d) for d in buckets["flagged"]],
        unassigned_today=[DeliveryResponse.model_validate(d) for d in buckets["unassigned_today"]],
    )


@router.get("/activity", response_model=ActivityResponse)
def dashboard_activity(
    limit: int = Query(25, ge=1, le=100),
    offset: int = Query(0, ge=0),
    event_type: str | None = None,
    ctx: AuthContext = Depends(require_manager),
    db: Session = Depends(get_db),
):
    events, total = delivery_service.dashboard_activity(
        db, limit=limit, offset=offset, event_type=event_type
    )
    return ActivityResponse(
        events=[DeliveryEventResponse.model_validate(e) for e in events],
        total=total,
    )
