"""User management schemas."""

from datetime import datetime
from uuid import UUID

from pydantic import ConfigDict, Field

from app.models.enums import Role
from app.schemas.common import CleanStr, EmailAddr, ORMModel, Page, UsPhone


class UserResponse(ORMModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    first_name: str
    last_name: str
    email: str
    role: Role
    phone: str | None = None
    is_active: bool
    must_change_password: bool
    password_changed_at: datetime | None = None
    last_login_at: datetime | None = None
    created_at: datetime
    updated_at: datetime

    @property
    def full_name(self) -> str:
        return f"{self.first_name} {self.last_name}".strip()


class CreateUserRequest(ORMModel):
    model_config = ConfigDict(from_attributes=True)

    first_name: CleanStr = Field(..., min_length=1, max_length=100)
    last_name: CleanStr = Field(..., min_length=1, max_length=100)
    email: EmailAddr = Field(..., max_length=254)
    role: Role
    phone: UsPhone | None = Field(default=None)
    password: str = Field(..., min_length=1)


class UpdateUserRequest(ORMModel):
    model_config = ConfigDict(from_attributes=True)

    first_name: CleanStr | None = Field(default=None, min_length=1, max_length=100)
    last_name: CleanStr | None = Field(default=None, min_length=1, max_length=100)
    email: EmailAddr | None = Field(default=None, max_length=254)
    role: Role | None = None
    phone: UsPhone | None = Field(default=None)
    is_active: bool | None = None


class ResetPasswordRequest(ORMModel):
    model_config = ConfigDict(from_attributes=True)

    new_password: str = Field(..., min_length=1)


class DriverBrief(ORMModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    first_name: str
    last_name: str
    email: str
    phone: str | None = None
    is_active: bool


UserListResponse = Page[UserResponse]

__all__ = [
    "UserResponse",
    "CreateUserRequest",
    "UpdateUserRequest",
    "ResetPasswordRequest",
    "DriverBrief",
    "UserListResponse",
    "Page",
]
