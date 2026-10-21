"""Delivery aggregate: deliveries, proof photographs and the append-only event log."""

import uuid
from datetime import date, datetime, time
from decimal import Decimal

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    Time,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, created_col, updated_col, uuid_pk
from app.models.enums import (
    DeliveryStatus,
    EventType,
    FailureReason,
    ProofKind,
    ProofReviewStatus,
    sql_in,
)
from app.models.user import User


class Delivery(Base):
    __tablename__ = "deliveries"
    __table_args__ = (
        CheckConstraint(f"status IN ({sql_in(DeliveryStatus)})", name="status_valid"),
        CheckConstraint(
            "(status = 'PENDING' AND assigned_driver_id IS NULL) OR "
            "(status IN ('ASSIGNED','IN_TRANSIT') AND assigned_driver_id IS NOT NULL) OR "
            "status IN ('DELIVERED','FAILED','CANCELED')",
            name="assignment_consistent",
        ),
        CheckConstraint("status <> 'DELIVERED' OR delivered_at IS NOT NULL", name="delivered_has_timestamp"),
        CheckConstraint(
            f"failure_reason IS NULL OR failure_reason IN ({sql_in(FailureReason)})", name="failure_reason_valid"
        ),
        CheckConstraint(
            "time_window_end IS NULL OR time_window_start IS NULL OR time_window_end > time_window_start",
            name="time_window_ordered",
        ),
        CheckConstraint("version >= 1", name="version_positive"),
        Index("ix_deliveries_status", "status"),
        Index("ix_deliveries_scheduled_date", "scheduled_date"),
        Index("ix_deliveries_driver_date", "assigned_driver_id", "scheduled_date"),
        Index("ix_deliveries_driver_status", "assigned_driver_id", "status"),
        Index("ix_deliveries_updated_at", "updated_at"),
        Index("ix_deliveries_external_order_ref", "external_order_ref"),
        Index("ix_deliveries_created_at", "created_at"),
        Index("ix_deliveries_delivered_at", "delivered_at"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    reference: Mapped[str] = mapped_column(String(40), nullable=False, unique=True)
    external_order_ref: Mapped[str | None] = mapped_column(String(80))
    recipient_name: Mapped[str] = mapped_column(String(200), nullable=False)
    recipient_phone: Mapped[str | None] = mapped_column(String(20))
    address_line1: Mapped[str] = mapped_column(String(200), nullable=False)
    address_line2: Mapped[str | None] = mapped_column(String(200))
    city: Mapped[str] = mapped_column(String(100), nullable=False)
    state: Mapped[str] = mapped_column(String(2), nullable=False)
    zip_code: Mapped[str] = mapped_column(String(10), nullable=False)
    country: Mapped[str] = mapped_column(String(2), nullable=False, server_default="US")
    scheduled_date: Mapped[date] = mapped_column(Date, nullable=False)
    time_window_start: Mapped[time | None] = mapped_column(Time)
    time_window_end: Mapped[time | None] = mapped_column(Time)
    instructions: Mapped[str | None] = mapped_column(Text)
    assigned_driver_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT")
    )
    status: Mapped[str] = mapped_column(String(20), nullable=False, server_default="PENDING")
    manager_notes: Mapped[str | None] = mapped_column(Text)
    driver_notes: Mapped[str | None] = mapped_column(Text)
    failure_reason: Mapped[str | None] = mapped_column(String(30))
    failure_notes: Mapped[str | None] = mapped_column(Text)
    recipient_name_confirmed: Mapped[str | None] = mapped_column(String(200))
    assigned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    attempted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[datetime] = created_col()
    updated_at: Mapped[datetime] = updated_col()
    version: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("1"))

    assigned_driver: Mapped[User | None] = relationship(foreign_keys=[assigned_driver_id], lazy="raise")
    created_by: Mapped[User] = relationship(foreign_keys=[created_by_id], lazy="raise")
    proofs: Mapped[list["DeliveryProof"]] = relationship(
        back_populates="delivery", lazy="raise", order_by="DeliveryProof.uploaded_at"
    )

    # Transient, query-populated counters (not columns); see services.delivery._hydrate.
    proof_count = 0
    flagged_count = 0


class DeliveryProof(Base):
    __tablename__ = "delivery_proofs"
    __table_args__ = (
        CheckConstraint(f"kind IN ({sql_in(ProofKind)})", name="kind_valid"),
        CheckConstraint(f"review_status IN ({sql_in(ProofReviewStatus)})", name="review_status_valid"),
        CheckConstraint("size_bytes > 0", name="size_positive"),
        CheckConstraint("latitude IS NULL OR latitude BETWEEN -90 AND 90", name="latitude_range"),
        CheckConstraint("longitude IS NULL OR longitude BETWEEN -180 AND 180", name="longitude_range"),
        CheckConstraint(
            "(latitude IS NULL AND longitude IS NULL) OR (latitude IS NOT NULL AND longitude IS NOT NULL AND location_consent)",
            name="location_requires_consent",
        ),
        Index("ix_delivery_proofs_delivery", "delivery_id", "uploaded_at"),
        Index("ix_delivery_proofs_review", "review_status"),
        Index("ix_delivery_proofs_sha256", "sha256"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    delivery_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("deliveries.id", ondelete="RESTRICT"), nullable=False
    )
    uploader_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    kind: Mapped[str] = mapped_column(String(20), nullable=False, server_default="DELIVERY")
    object_key: Mapped[str] = mapped_column(String(300), nullable=False, unique=True)
    thumbnail_key: Mapped[str] = mapped_column(String(300), nullable=False, unique=True)
    # Browser-compatible, metadata-stripped, orientation-corrected large JPEG used for full-size viewing
    # (originals may be HEIC which most browsers cannot render). The original is never modified.
    preview_key: Mapped[str | None] = mapped_column(String(300), unique=True)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    content_type: Mapped[str] = mapped_column(String(50), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    width: Mapped[int] = mapped_column(Integer, nullable=False)
    height: Mapped[int] = mapped_column(Integer, nullable=False)
    original_filename: Mapped[str | None] = mapped_column(String(120))
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    location_consent: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    latitude: Mapped[Decimal | None] = mapped_column(Numeric(9, 6))
    longitude: Mapped[Decimal | None] = mapped_column(Numeric(9, 6))
    location_accuracy_m: Mapped[Decimal | None] = mapped_column(Numeric(8, 1))
    review_status: Mapped[str] = mapped_column(String(10), nullable=False, server_default="NONE")
    review_reason: Mapped[str | None] = mapped_column(Text)
    reviewed_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT")
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deleted_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT")
    )
    deletion_reason: Mapped[str | None] = mapped_column(Text)

    delivery: Mapped[Delivery] = relationship(back_populates="proofs", lazy="raise")
    uploader: Mapped[User] = relationship(foreign_keys=[uploader_id], lazy="raise")
    reviewed_by: Mapped[User | None] = relationship(foreign_keys=[reviewed_by_id], lazy="raise")


class DeliveryEvent(Base):
    """Append-only operational history. Updates/deletes are blocked by a database trigger."""

    __tablename__ = "delivery_events"
    __table_args__ = (
        CheckConstraint(f"event_type IN ({sql_in(EventType)})", name="event_type_valid"),
        Index("ix_delivery_events_delivery", "delivery_id", "created_at"),
        Index("ix_delivery_events_created", "created_at"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    delivery_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("deliveries.id", ondelete="RESTRICT"), nullable=False
    )
    actor_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT")
    )
    event_type: Mapped[str] = mapped_column(String(30), nullable=False)
    from_status: Mapped[str | None] = mapped_column(String(20))
    to_status: Mapped[str | None] = mapped_column(String(20))
    reason: Mapped[str | None] = mapped_column(Text)
    details: Mapped[dict] = mapped_column("metadata", JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    actor: Mapped[User | None] = relationship(foreign_keys=[actor_id], lazy="raise")
    delivery: Mapped[Delivery] = relationship(foreign_keys=[delivery_id], lazy="raise")

    @property
    def delivery_reference(self) -> str | None:
        d = self.__dict__.get("delivery")
        return d.reference if d is not None else None
