"""User management service (CRUD, admin operations)."""

import logging
import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import Conflict, NotFound, ValidationFailed, field_error
from app.models import User
from app.models.enums import Role
from app.security.passwords import hash_password, validate_password_strength
from app.services.auth import audit, revoke_all_sessions
from app.utils.common import normalize_email, utcnow

log = logging.getLogger("prooftrack.users")


def list_users(db: Session, *, role: str | None = None, is_active: bool | None = None,
               search: str | None = None, page: int = 1, page_size: int = 25) -> tuple[list[User], int]:
    q = select(User)
    if role:
        q = q.where(User.role == role)
    if is_active is not None:
        q = q.where(User.is_active == is_active)
    if search:
        pat = f"%{search.strip()}%"
        q = q.where((User.first_name.ilike(pat)) | (User.last_name.ilike(pat)) | (User.email.ilike(pat)))
    total = db.scalar(select(func.count()).select_from(q.subquery()))
    users = list(db.scalars(q.order_by(User.last_name, User.first_name).offset((page - 1) * page_size).limit(page_size)))
    return users, total or 0


def get_user(db: Session, user_id: uuid.UUID) -> User:
    user = db.get(User, user_id)
    if not user:
        raise NotFound("User not found.")
    return user


def create_user(db: Session, *, first_name: str, last_name: str, email: str, role: str,
                phone: str | None, password: str, actor_id: uuid.UUID, ip: str | None) -> User:
    email = normalize_email(email)
    _check_email_unique(db, email)
    problems = validate_password_strength(password)
    if problems:
        raise ValidationFailed(problems[0], details=[field_error("password", p) for p in problems])
    user = User(
        id=uuid.uuid4(),
        first_name=first_name, last_name=last_name, email=email, role=role, phone=phone,
        password_hash=hash_password(password), must_change_password=True,
    )
    db.add(user)
    db.flush()
    audit(db, "user.created", actor_id=actor_id, entity_type="user", entity_id=str(user.id), ip=ip, role=role)
    db.commit()
    db.refresh(user)
    return user


def update_user(db: Session, user_id: uuid.UUID, *, updates: dict, actor_id: uuid.UUID, ip: str | None) -> User:
    user = get_user(db, user_id)
    if "email" in updates:
        updates["email"] = normalize_email(updates["email"])
        if updates["email"] != user.email:
            _check_email_unique(db, updates["email"])
    changed: dict = {}
    for field in ("first_name", "last_name", "email", "phone", "role"):
        if field in updates and updates[field] != getattr(user, field):
            changed[field] = {"from": getattr(user, field), "to": updates[field]}
            setattr(user, field, updates[field])
    if "is_active" in updates and updates["is_active"] != user.is_active:
        changed["is_active"] = {"from": user.is_active, "to": updates["is_active"]}
        user.is_active = updates["is_active"]
        if not user.is_active:
            revoke_all_sessions(db, user.id)
    if not changed:
        return user
    user.updated_at = utcnow()
    audit(db, "user.updated", actor_id=actor_id, entity_type="user", entity_id=str(user_id), ip=ip, changes=changed)
    db.commit()
    db.refresh(user)
    return user


def reset_password(db: Session, user_id: uuid.UUID, *, new_password: str, actor_id: uuid.UUID, ip: str | None) -> None:
    user = get_user(db, user_id)
    problems = validate_password_strength(new_password)
    if problems:
        raise ValidationFailed(problems[0], details=[field_error("new_password", p) for p in problems])
    user.password_hash = hash_password(new_password)
    user.must_change_password = True
    user.password_changed_at = utcnow()
    revoke_all_sessions(db, user.id)
    audit(db, "user.password_reset", actor_id=actor_id, entity_type="user", entity_id=str(user_id), ip=ip)
    db.commit()


def list_drivers(db: Session, active_only: bool = True) -> list[User]:
    q = select(User).where(User.role == Role.DRIVER).order_by(User.last_name, User.first_name)
    if active_only:
        q = q.where(User.is_active.is_(True))
    return list(db.scalars(q))


def _check_email_unique(db: Session, email: str) -> None:
    exists = db.scalar(select(func.count()).select_from(User).where(User.email == email))
    if exists:
        raise Conflict("A user with this email address already exists.", details=[field_error("email", "This email is already in use.")])
