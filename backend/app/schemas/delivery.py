"""Delivery aggregate, proof, and dispatch schemas."""

from datetime import date, datetime, time
from decimal import Decimal
from typing import Any
from uuid import UUID

from pydantic import ConfigDict, Field, field_validator, model_validator

from app.models.enums import (
    DeliveryStatus,
    EventType,
    FailureReason,
    ProofKind,
    ProofReviewStatus,
)
from app.schemas.common import (
    CleanStr,
    ORMModel,
    Page,
    UsPhone,
    UsState,
    UsZip,
    UserBrief,
    _empty_to_none,
)


class CreateDeliveryRequest(ORMModel):
    """Payload for creating a new delivery."""

    model_config = ConfigDict(from_attributes=True)

    reference: str | None = Field(default=None, max_length=40, description="Optional custom reference; auto-generated if omitted")
    external_order_ref: str | None = Field(default=None, max_length=80, description="External order or tracking reference")
    recipient_name: CleanStr = Field(..., min_length=1, max_length=200, description="Name of the package recipient")
    recipient_phone: UsPhone | None = Field(default=None, description="Contact phone for recipient")
    address_line1: CleanStr = Field(..., min_length=1, max_length=200, description="Primary street address")
    address_line2: str | None = Field(default=None, max_length=200, description="Suite, apt, or unit number")
    city: CleanStr = Field(..., min_length=1, max_length=100, description="Delivery city")
    state: UsState = Field(..., description="Two-letter US state code")
    zip_code: UsZip = Field(..., description="5-digit or 9-digit US ZIP code")
    country: str = Field(default="US", min_length=2, max_length=2, description="Two-letter country code")
    scheduled_date: date = Field(..., description="Target delivery date")
    time_window_start: time | None = Field(default=None, description="Earliest acceptable delivery time")
    time_window_end: time | None = Field(default=None, description="Latest acceptable delivery time")
    instructions: str | None = Field(default=None, description="Delivery notes or gate codes")
    assigned_driver_id: UUID | None = Field(default=None, description="Optional initial driver assignment")
    manager_notes: str | None = Field(default=None, description="Internal dispatch/management notes")

    @field_validator(
        "reference",
        "external_order_ref",
        "recipient_phone",
        "address_line2",
        "instructions",
        "manager_notes",
        mode="before",
    )
    @classmethod
    def _coerce_empty_strings(cls, v: object) -> object:
        return _empty_to_none(v)

    @model_validator(mode="after")
    def _validate_time_window(self) -> "CreateDeliveryRequest":
        if self.time_window_start and self.time_window_end:
            if self.time_window_end <= self.time_window_start:
                raise ValueError("time_window_end must be later than time_window_start.")
        return self


class UpdateDeliveryRequest(ORMModel):
    """Payload for updating delivery details with optimistic locking."""

    model_config = ConfigDict(from_attributes=True)

    reference: str | None = Field(default=None, max_length=40, description="Unique reference code")
    external_order_ref: str | None = Field(default=None, max_length=80, description="External order or tracking reference")
    recipient_name: CleanStr | None = Field(default=None, min_length=1, max_length=200, description="Recipient full name")
    recipient_phone: UsPhone | None = Field(default=None, description="Recipient phone number")
    address_line1: CleanStr | None = Field(default=None, min_length=1, max_length=200, description="Primary street address")
    address_line2: str | None = Field(default=None, max_length=200, description="Suite, apt, or unit number")
    city: CleanStr | None = Field(default=None, min_length=1, max_length=100, description="Delivery city")
    state: UsState | None = Field(default=None, description="Two-letter US state code")
    zip_code: UsZip | None = Field(default=None, description="5-digit or 9-digit US ZIP code")
    country: str | None = Field(default=None, min_length=2, max_length=2, description="Two-letter country code")
    scheduled_date: date | None = Field(default=None, description="Target delivery date")
    time_window_start: time | None = Field(default=None, description="Earliest delivery time")
    time_window_end: time | None = Field(default=None, description="Latest delivery time")
    instructions: str | None = Field(default=None, description="Delivery notes or gate codes")
    assigned_driver_id: UUID | None = Field(default=None, description="Assigned driver user ID")
    manager_notes: str | None = Field(default=None, description="Internal dispatch/management notes")
    version: int | None = Field(default=None, ge=1, description="Expected entity version for optimistic locking")

    @field_validator(
        "reference",
        "external_order_ref",
        "recipient_phone",
        "address_line2",
        "instructions",
        "manager_notes",
        mode="before",
    )
    @classmethod
    def _coerce_empty_strings(cls, v: object) -> object:
        return _empty_to_none(v)

    @model_validator(mode="after")
    def _validate_time_window(self) -> "UpdateDeliveryRequest":
        if self.time_window_start and self.time_window_end:
            if self.time_window_end <= self.time_window_start:
                raise ValueError("time_window_end must be later than time_window_start.")
        return self


class AssignDriverRequest(ORMModel):
    """Payload to assign or reassign a driver to a delivery."""

    model_config = ConfigDict(from_attributes=True)

    driver_id: UUID = Field(..., description="ID of the driver to assign")
    scheduled_date: date | None = Field(default=None, description="Optional new scheduled date when reassigning")
    reason: str | None = Field(default=None, description="Optional reason for reassignment")


class StartDeliveryRequest(ORMModel):
    """Empty payload for transitioning a delivery to IN_TRANSIT."""

    model_config = ConfigDict(from_attributes=True)


class FailDeliveryRequest(ORMModel):
    """Payload for recording an unsuccessful delivery attempt."""

    model_config = ConfigDict(from_attributes=True)

    reason: FailureReason = Field(..., description="Categorized failure reason")
    notes: str | None = Field(default=None, description="Driver notes describing the issue")
    idempotency_key: str | None = Field(default=None, max_length=100, description="Client idempotency key")


class ReopenDeliveryRequest(ORMModel):
    """Payload for reopening a failed, delivered, or canceled delivery."""

    model_config = ConfigDict(from_attributes=True)

    reason: str = Field(..., min_length=1, description="Justification for reopening the delivery")
    driver_id: UUID | None = Field(default=None, description="Optional driver to assign upon reopening")
    scheduled_date: date | None = Field(default=None, description="Optional new scheduled delivery date")


class CancelDeliveryRequest(ORMModel):
    """Payload for canceling a delivery."""

    model_config = ConfigDict(from_attributes=True)

    reason: str | None = Field(default=None, description="Optional reason for cancellation")


class DeliveryResponse(ORMModel):
    """Full delivery representation returned by delivery endpoints."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    reference: str
    external_order_ref: str | None = None
    recipient_name: str
    recipient_phone: str | None = None
    address_line1: str
    address_line2: str | None = None
    city: str
    state: str
    zip_code: str
    country: str
    scheduled_date: date
    time_window_start: time | None = None
    time_window_end: time | None = None
    instructions: str | None = None
    assigned_driver_id: UUID | None = None
    status: DeliveryStatus
    manager_notes: str | None = None
    driver_notes: str | None = None
    failure_reason: FailureReason | None = None
    failure_notes: str | None = None
    recipient_name_confirmed: str | None = None
    assigned_at: datetime | None = None
    started_at: datetime | None = None
    delivered_at: datetime | None = None
    attempted_at: datetime | None = None
    created_by_id: UUID
    created_at: datetime
    updated_at: datetime
    version: int

    assigned_driver: UserBrief | None = None
    proof_count: int = 0
    flagged_count: int = 0

    @property
    def full_address(self) -> str:
        """Formatted full address line."""
        parts = [self.address_line1]
        if self.address_line2:
            parts.append(self.address_line2)
        parts.append(f"{self.city}, {self.state} {self.zip_code}")
        return ", ".join(parts)


class DeliveryEventResponse(ORMModel):
    """Delivery timeline audit event."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    delivery_id: UUID
    actor_id: UUID | None = None
    actor: UserBrief | None = None
    event_type: EventType
    from_status: DeliveryStatus | None = None
    to_status: DeliveryStatus | None = None
    reason: str | None = None
    details: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    delivery_reference: str | None = None


class ProofResponse(ORMModel):
    """Proof photograph and verification metadata."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    delivery_id: UUID
    uploader_id: UUID | None = None
    uploader: UserBrief | None = None
    kind: ProofKind
    content_type: str
    size_bytes: int
    width: int
    height: int
    uploaded_at: datetime
    location_consent: bool
    latitude: Decimal | None = None
    longitude: Decimal | None = None
    review_status: ProofReviewStatus
    sha256: str
    original_filename: str | None = None
    location_accuracy_m: Decimal | None = None
    review_reason: str | None = None
    reviewed_by: UserBrief | None = None
    reviewed_at: datetime | None = None


class FlagProofRequest(ORMModel):
    """Payload to flag a proof photo for managerial review."""

    model_config = ConfigDict(from_attributes=True)

    reason: str = Field(..., min_length=1, description="Reason for flagging the delivery proof")


class DashboardSummary(ORMModel):
    """Operational KPI summary metrics for dispatchers and managers."""

    model_config = ConfigDict(from_attributes=True)

    total: int = 0
    pending: int = 0
    assigned: int = 0
    in_transit: int = 0
    delivered: int = 0
    failed: int = 0
    canceled: int = 0
    overdue: int = 0
    completion_pct: float = 0.0
    business_today: date | None = None
    business_timezone: str | None = None
    definitions: dict[str, str] = Field(default_factory=dict)


class DashboardAttention(ORMModel):
    """Deliveries requiring dispatcher attention and recent operational highlights."""

    overdue: list[DeliveryResponse] = Field(default_factory=list)
    recent_failures: list[DeliveryResponse] = Field(default_factory=list)
    recently_completed: list[DeliveryResponse] = Field(default_factory=list)
    flagged: list[DeliveryResponse] = Field(default_factory=list)
    unassigned_today: list[DeliveryResponse] = Field(default_factory=list)


class ActivityResponse(ORMModel):
    """Timeline feed containing a sequence of delivery events."""

    model_config = ConfigDict(from_attributes=True)

    events: list[DeliveryEventResponse] = Field(default_factory=list)
    total: int = 0


# Paginated list of deliveries
DeliveryListResponse = Page[DeliveryResponse]

__all__ = [
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
    "DashboardAttention",
    "ActivityResponse",
]
