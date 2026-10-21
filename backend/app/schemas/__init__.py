"""Pydantic schemas for the ProofTrack application."""

from app.schemas.auth import (
    AuthResponse,
    ChangePasswordRequest,
    CSRFResponse,
    LoginRequest,
    UserResponse,
)
from app.schemas.common import (
    CleanStr,
    ORMModel,
    Page,
    UsPhone,
    UsState,
    UsZip,
    UserBrief,
    normalize_us_phone,
)
from app.schemas.delivery import (
    ActivityResponse,
    AssignDriverRequest,
    CancelDeliveryRequest,
    CreateDeliveryRequest,
    DashboardSummary,
    DeliveryEventResponse,
    DeliveryListResponse,
    DeliveryResponse,
    FailDeliveryRequest,
    FlagProofRequest,
    ProofResponse,
    ReopenDeliveryRequest,
    StartDeliveryRequest,
    UpdateDeliveryRequest,
)
from app.schemas.users import (
    CreateUserRequest,
    DriverBrief,
    ResetPasswordRequest,
    UpdateUserRequest,
    UserListResponse,
)

__all__ = [
    # Common
    "CleanStr",
    "UsPhone",
    "UsState",
    "UsZip",
    "ORMModel",
    "Page",
    "UserBrief",
    "normalize_us_phone",
    # Auth
    "LoginRequest",
    "ChangePasswordRequest",
    "UserResponse",
    "AuthResponse",
    "CSRFResponse",
    # Users
    "CreateUserRequest",
    "UpdateUserRequest",
    "ResetPasswordRequest",
    "DriverBrief",
    "UserListResponse",
    # Delivery
    "CreateDeliveryRequest",
    "UpdateDeliveryRequest",
    "AssignDriverRequest",
    "StartDeliveryRequest",
    "FailDeliveryRequest",
    "ReopenDeliveryRequest",
    "CancelDeliveryRequest",
    "DeliveryResponse",
    "DeliveryListResponse",
    "DeliveryEventResponse",
    "ProofResponse",
    "FlagProofRequest",
    "DashboardSummary",
    "ActivityResponse",
]
