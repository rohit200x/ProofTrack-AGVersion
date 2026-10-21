"""Authentication endpoints."""

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.session import get_db
from app.schemas.auth import AuthResponse, ChangePasswordRequest, CSRFResponse, LoginRequest
from app.schemas.users import UserResponse
from app.security.deps import AuthContext, auth_any_state
from app.security.tokens import csrf_token_for, hash_token
from app.services import auth as auth_service
from app.utils.common import client_ip

router = APIRouter(prefix="/api/v1/auth", tags=["Authentication"])


def _set_session_cookie(response: Response, token: str) -> None:
    s = get_settings()
    response.set_cookie(
        key=s.session_cookie_name,
        value=token,
        httponly=True,
        secure=s.use_secure_cookies,
        samesite=s.cookie_samesite,
        path="/",
        max_age=s.session_absolute_hours * 3600,
    )


def _delete_session_cookie(response: Response) -> None:
    s = get_settings()
    response.delete_cookie(key=s.session_cookie_name, path="/", httponly=True, secure=s.use_secure_cookies, samesite=s.cookie_samesite)


@router.post("/login", response_model=AuthResponse)
def login(body: LoginRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    user, token = auth_service.login(db, body.email, body.password, client_ip(request), request.headers.get("user-agent"))
    _set_session_cookie(response, token)
    return AuthResponse(user=UserResponse.model_validate(user), csrf_token=csrf_token_for(hash_token(token)))


@router.post("/logout")
def logout(response: Response, ctx: AuthContext = Depends(auth_any_state), db: Session = Depends(get_db)):
    auth_service.revoke_session(db, ctx.session)
    _delete_session_cookie(response)
    return {"message": "Logged out"}


@router.get("/me", response_model=UserResponse)
def me(ctx: AuthContext = Depends(auth_any_state)):
    return UserResponse.model_validate(ctx.user)


@router.post("/change-password")
def change_password(body: ChangePasswordRequest, request: Request, ctx: AuthContext = Depends(auth_any_state), db: Session = Depends(get_db)):
    auth_service.change_password(db, ctx.user, ctx.session, body.current_password, body.new_password, client_ip(request))
    return {"message": "Password changed successfully."}


@router.get("/csrf", response_model=CSRFResponse)
def csrf(ctx: AuthContext = Depends(auth_any_state)):
    return CSRFResponse(csrf_token=csrf_token_for(ctx.session.token_hash))
