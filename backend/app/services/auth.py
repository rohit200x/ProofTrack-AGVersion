"""Authentication and session lifecycle."""

import logging
import uuid
from datetime import timedelta

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import TooManyRequests, Unauthorized, ValidationFailed, field_error
from app.models import AuditLog, LoginAttempt, User, UserSession
from app.security.passwords import hash_password, needs_rehash, validate_password_strength, verify_password
from app.security.tokens import generate_session_token, hash_token
from app.utils.common import normalize_email, utcnow

log = logging.getLogger("prooftrack.auth")
INVALID_CREDENTIALS = "Incorrect email or password."


def audit(db: Session, action: str, *, actor_id: uuid.UUID | None = None, entity_type: str | None = None,
          entity_id: str | None = None, ip: str | None = None, **details) -> None:
    db.add(AuditLog(actor_id=actor_id, action=action, entity_type=entity_type, entity_id=entity_id,
                    ip_address=ip, details=details))
    log.info("audit", extra={"audit_action": action, "entity_type": entity_type, "entity_id": entity_id,
                             "actor_id": str(actor_id) if actor_id else None})


def _check_rate_limit(db: Session, email: str, ip: str | None) -> None:
    s = get_settings()
    since = utcnow() - timedelta(minutes=s.login_window_minutes)
    by_email = db.scalar(
        select(func.count()).select_from(LoginAttempt).where(
            LoginAttempt.email == email, LoginAttempt.succeeded.is_(False), LoginAttempt.created_at >= since
        )
    )
    by_ip = 0
    if ip:
        by_ip = db.scalar(
            select(func.count()).select_from(LoginAttempt).where(
                LoginAttempt.ip_address == ip, LoginAttempt.succeeded.is_(False), LoginAttempt.created_at >= since
            )
        )
    if (by_email or 0) >= s.login_max_failures or (by_ip or 0) >= s.login_max_failures_per_ip:
        raise TooManyRequests(
            f"Too many failed sign-in attempts. Try again in {s.login_window_minutes} minutes.",
            headers={"Retry-After": str(s.login_window_minutes * 60)},
        )


def login(db: Session, email: str, password: str, ip: str | None, user_agent: str | None) -> tuple[User, str]:
    s = get_settings()
    email = normalize_email(email)
    _check_rate_limit(db, email, ip)
    user = db.scalar(select(User).where(User.email == email))
    ok = verify_password(password, user.password_hash if user else None)
    if not ok or user is None or not user.is_active:
        db.add(LoginAttempt(email=email, ip_address=ip, succeeded=False))
        audit(db, "auth.login_failed", ip=ip, email=email, reason="inactive" if user and not user.is_active else "bad_credentials")
        db.commit()
        raise Unauthorized(INVALID_CREDENTIALS, code="INVALID_CREDENTIALS")

    if needs_rehash(user.password_hash):
        user.password_hash = hash_password(password)
    now = utcnow()
    token = generate_session_token()
    db.add(
        UserSession(
            user_id=user.id, token_hash=hash_token(token), created_at=now, last_seen_at=now,
            expires_at=now + timedelta(hours=s.session_absolute_hours), ip_address=ip,
            user_agent=(user_agent or "")[:300] or None,
        )
    )
    user.last_login_at = now
    db.add(LoginAttempt(email=email, ip_address=ip, succeeded=True))
    audit(db, "auth.login", actor_id=user.id, entity_type="user", entity_id=str(user.id), ip=ip)
    db.commit()
    return user, token


def resolve_session(db: Session, token: str) -> UserSession | None:
    """Returns the live session for a presented token or None if missing/expired/revoked/inactive."""
    s = get_settings()
    sess = db.scalar(select(UserSession).where(UserSession.token_hash == hash_token(token)))
    if sess is None or sess.revoked_at is not None:
        return None
    now = utcnow()
    if sess.expires_at <= now or sess.last_seen_at + timedelta(minutes=s.session_idle_minutes) <= now:
        return None
    if not sess.user.is_active:
        return None
    if (now - sess.last_seen_at).total_seconds() > 60:
        sess.last_seen_at = now
        db.commit()
    return sess


def revoke_session(db: Session, sess: UserSession) -> None:
    sess.revoked_at = utcnow()
    audit(db, "auth.logout", actor_id=sess.user_id, entity_type="user", entity_id=str(sess.user_id))
    db.commit()


def revoke_all_sessions(db: Session, user_id: uuid.UUID, *, except_session_id: uuid.UUID | None = None) -> None:
    stmt = update(UserSession).where(UserSession.user_id == user_id, UserSession.revoked_at.is_(None))
    if except_session_id:
        stmt = stmt.where(UserSession.id != except_session_id)
    db.execute(stmt.values(revoked_at=utcnow()))


def change_password(db: Session, user: User, current_session: UserSession, current_password: str,
                    new_password: str, ip: str | None) -> None:
    if not verify_password(current_password, user.password_hash):
        raise ValidationFailed("Current password is incorrect.", details=[field_error("current_password", "Current password is incorrect.")])
    if current_password == new_password:
        raise ValidationFailed("New password must differ from the current password.",
                               details=[field_error("new_password", "New password must differ from the current password.")])
    problems = validate_password_strength(new_password)
    if problems:
        raise ValidationFailed(problems[0], details=[field_error("new_password", p) for p in problems])
    user.password_hash = hash_password(new_password)
    user.must_change_password = False
    user.password_changed_at = utcnow()
    revoke_all_sessions(db, user.id, except_session_id=current_session.id)
    audit(db, "auth.password_changed", actor_id=user.id, entity_type="user", entity_id=str(user.id), ip=ip)
    db.commit()
