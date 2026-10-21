"""Driver-specific endpoints (my deliveries, history)."""

import math
from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.schemas.common import Page
from app.schemas.delivery import DeliveryResponse
from app.security.deps import AuthContext, require_driver
from app.services import delivery as delivery_service

router = APIRouter(prefix="/api/v1/driver", tags=["Driver"])


@router.get("/deliveries", response_model=list[DeliveryResponse])
def my_deliveries(
    date: date | None = None,
    status: str | None = None,
    search: str | None = None,
    include_overdue: bool = True,
    ctx: AuthContext = Depends(require_driver),
    db: Session = Depends(get_db),
):
    items = delivery_service.driver_deliveries(
        db,
        ctx.user.id,
        date_filter=date,
        status=status,
        search=search,
        include_overdue=include_overdue,
    )
    return [DeliveryResponse.model_validate(d) for d in items]


@router.get("/history", response_model=Page[DeliveryResponse])
def my_history(
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    ctx: AuthContext = Depends(require_driver),
    db: Session = Depends(get_db),
):
    items, total = delivery_service.driver_history(db, ctx.user.id, page=page, page_size=page_size)
    return Page(
        items=[DeliveryResponse.model_validate(d) for d in items],
        total=total,
        page=page,
        page_size=page_size,
        pages=math.ceil(total / page_size) if total else 0,
    )
