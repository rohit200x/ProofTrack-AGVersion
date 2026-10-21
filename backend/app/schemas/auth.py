"""Authentication schemas."""

from pydantic import ConfigDict, Field

from app.schemas.common import EmailAddr, ORMModel
from app.schemas.users import UserResponse


class LoginRequest(ORMModel):
    model_config = ConfigDict(from_attributes=True)

    email: EmailAddr = Field(..., max_length=254)
    password: str = Field(..., min_length=1)


class AuthResponse(ORMModel):
    model_config = ConfigDict(from_attributes=True)

    user: UserResponse
    csrf_token: str


class ChangePasswordRequest(ORMModel):
    model_config = ConfigDict(from_attributes=True)

    current_password: str = Field(..., min_length=1)
    new_password: str = Field(..., min_length=1)


class CSRFResponse(ORMModel):
    model_config = ConfigDict(from_attributes=True)

    csrf_token: str


__all__ = [
    "LoginRequest",
    "AuthResponse",
    "ChangePasswordRequest",
    "CSRFResponse",
    "UserResponse",
]
