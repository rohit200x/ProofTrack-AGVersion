"""Enumerations shared by models, schemas and services."""

from enum import StrEnum


class Role(StrEnum):
    ADMIN = "ADMIN"
    MANAGER = "MANAGER"
    DRIVER = "DRIVER"


class DeliveryStatus(StrEnum):
    PENDING = "PENDING"
    ASSIGNED = "ASSIGNED"
    IN_TRANSIT = "IN_TRANSIT"
    DELIVERED = "DELIVERED"
    FAILED = "FAILED"
    CANCELED = "CANCELED"


class FailureReason(StrEnum):
    RECIPIENT_UNAVAILABLE = "RECIPIENT_UNAVAILABLE"
    INCORRECT_ADDRESS = "INCORRECT_ADDRESS"
    ACCESS_DENIED = "ACCESS_DENIED"
    RECIPIENT_REFUSED = "RECIPIENT_REFUSED"
    PACKAGE_DAMAGED = "PACKAGE_DAMAGED"
    OTHER = "OTHER"


class EventType(StrEnum):
    CREATED = "CREATED"
    IMPORTED = "IMPORTED"
    UPDATED = "UPDATED"
    ASSIGNED = "ASSIGNED"
    REASSIGNED = "REASSIGNED"
    UNASSIGNED = "UNASSIGNED"
    STARTED = "STARTED"
    DELIVERED = "DELIVERED"
    FAILED = "FAILED"
    CANCELED = "CANCELED"
    REOPENED = "REOPENED"
    PROOF_FLAGGED = "PROOF_FLAGGED"
    PROOF_REVIEW_RESOLVED = "PROOF_REVIEW_RESOLVED"
    PROOF_DELETED = "PROOF_DELETED"


class ProofKind(StrEnum):
    DELIVERY = "DELIVERY"
    FAILED_ATTEMPT = "FAILED_ATTEMPT"


class ProofReviewStatus(StrEnum):
    NONE = "NONE"
    FLAGGED = "FLAGGED"
    RESOLVED = "RESOLVED"


class UploadAction(StrEnum):
    COMPLETE = "COMPLETE"
    FAIL = "FAIL"


class UploadStatus(StrEnum):
    IN_PROGRESS = "IN_PROGRESS"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


def sql_in(enum_cls: type[StrEnum]) -> str:
    return ", ".join(f"'{m.value}'" for m in enum_cls)
