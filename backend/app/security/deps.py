"""Authentication / authorization dependencies for FastAPI routes."""

from collections.abc import Callable
from dataclasses import dataclass

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import Forbidden, Unauthorized
from app.db.session import get_db
from app.models import User, UserSession
from app.models.enums import Role
from app.security.tokens import verify_csrf
from app.services import auth as auth_service
from app.utils.common import client_ip

SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


@dataclass
class AuthContext:
    user: User
    session: UserSession
    ip: str | None


def _authenticate(request: Request, db: Session) -> AuthContext:
    settings = get_settings()
    token = request.cookies.get(settings.session_cookie_name)
    if not token:
        raise Unauthorized("Authentication required.", code="NOT_AUTHENTICATED")
    sess = auth_service.resolve_session(db, token)
    if sess is None:
        raise Unauthorized("Your session has expired. Please sign in again.", code="SESSION_EXPIRED")
    if request.method not in SAFE_METHODS and not verify_csrf(sess.token_hash, request.headers.get("x-csrf-token")):
        raise Forbidden("Missing or invalid CSRF token.", code="CSRF_FAILED")
    return AuthContext(user=sess.user, session=sess, ip=client_ip(request))


def auth_any_state(request: Request, db: Session = Depends(get_db)) -> AuthContext:
    """Authenticated user, even if a password change is pending (used by /auth endpoints)."""
    return _authenticate(request, db)


def auth_ctx(request: Request, db: Session = Depends(get_db)) -> AuthContext:
    ctx = _authenticate(request, db)
    if ctx.user.must_change_password:
        raise Forbidden("You must change your password before continuing.", code="PASSWORD_CHANGE_REQUIRED")
    return ctx


def require_roles(*roles: Role) -> Callable[..., AuthContext]:
    allowed = {r.value for r in roles}

    def dep(ctx: AuthContext = Depends(auth_ctx)) -> AuthContext:
        if ctx.user.role not in allowed:
            raise Forbidden("You do not have permission to perform this action.")
        return ctx

    return dep


require_admin = require_roles(Role.ADMIN)
require_manager = require_roles(Role.ADMIN, Role.MANAGER)
require_driver = require_roles(Role.DRIVER)
