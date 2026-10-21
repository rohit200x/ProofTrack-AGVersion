"""User and driver management endpoints."""

import math
import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.schemas.common import Page
from app.schemas.users import CreateUserRequest, DriverBrief, ResetPasswordRequest, UpdateUserRequest, UserResponse
from app.security.deps import AuthContext, require_admin, require_manager
from app.services import users as users_service

router = APIRouter(prefix="/api/v1/users", tags=["Users"])
drivers_router = APIRouter(prefix="/api/v1/drivers", tags=["Drivers"])


@router.get("", response_model=Page[UserResponse])
def list_users(
    role: str | None = None, is_active: bool | None = None, search: str | None = None,
    page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=100),
    ctx: AuthContext = Depends(require_admin), db: Session = Depends(get_db),
):
    users, total = users_service.list_users(db, role=role, is_active=is_active, search=search, page=page, page_size=page_size)
    return Page(items=[UserResponse.model_validate(u) for u in users], total=total, page=page, page_size=page_size, pages=math.ceil(total / page_size) if total else 0)


@router.post("", response_model=UserResponse, status_code=201)
def create_user(body: CreateUserRequest, ctx: AuthContext = Depends(require_admin), db: Session = Depends(get_db)):
    user = users_service.create_user(
        db, first_name=body.first_name, last_name=body.last_name, email=body.email, role=body.role,
        phone=body.phone, password=body.password, actor_id=ctx.user.id, ip=ctx.ip,
    )
    return UserResponse.model_validate(user)


@router.get("/{user_id}", response_model=UserResponse)
def get_user(user_id: uuid.UUID, ctx: AuthContext = Depends(require_admin), db: Session = Depends(get_db)):
    return UserResponse.model_validate(users_service.get_user(db, user_id))


@router.patch("/{user_id}", response_model=UserResponse)
def update_user(user_id: uuid.UUID, body: UpdateUserRequest, ctx: AuthContext = Depends(require_admin), db: Session = Depends(get_db)):
    updates = body.model_dump(exclude_unset=True)
    user = users_service.update_user(db, user_id, updates=updates, actor_id=ctx.user.id, ip=ctx.ip)
    return UserResponse.model_validate(user)


@router.post("/{user_id}/reset-password")
def reset_password(user_id: uuid.UUID, body: ResetPasswordRequest, ctx: AuthContext = Depends(require_admin), db: Session = Depends(get_db)):
    users_service.reset_password(db, user_id, new_password=body.new_password, actor_id=ctx.user.id, ip=ctx.ip)
    return {"message": "Password has been reset. The user must change their password at next login."}


@drivers_router.get("", response_model=list[DriverBrief])
def list_drivers(active_only: bool = True, ctx: AuthContext = Depends(require_manager), db: Session = Depends(get_db)):
    return [DriverBrief.model_validate(d) for d in users_service.list_drivers(db, active_only=active_only)]
