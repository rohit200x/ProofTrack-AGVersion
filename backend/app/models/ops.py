"""Operational support tables: idempotency records, org settings, security audit log, login throttling."""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, func, text
from sqlalchemy.dialects.postgresql import INET, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, created_col, updated_col, uuid_pk
from app.models.enums import UploadAction, UploadStatus, sql_in


class UploadRequest(Base):
    """Persisted idempotency record for proof submissions (complete / fail)."""

    __tablename__ = "upload_requests"
    __table_args__ = (
        UniqueConstraint("user_id", "idempotency_key", name="uq_upload_requests_user_key"),
        CheckConstraint(f"action IN ({sql_in(UploadAction)})", name="action_valid"),
        CheckConstraint(f"status IN ({sql_in(UploadStatus)})", name="status_valid"),
        Index("ix_upload_requests_status_created", "status", "created_at"),
        Index("ix_upload_requests_delivery", "delivery_id"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    idempotency_key: Mapped[str] = mapped_column(String(100), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    delivery_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("deliveries.id", ondelete="RESTRICT"), nullable=False
    )
    action: Mapped[str] = mapped_column(String(10), nullable=False)
    fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(12), nullable=False, server_default="IN_PROGRESS")
    # Object keys written to storage by this request; used to reconcile orphans after interrupted operations.
    pending_object_keys: Mapped[list] = mapped_column(JSONB, nullable=False, server_default=text("'[]'::jsonb"))
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("1"))
    error_code: Mapped[str | None] = mapped_column(String(60))
    created_at: Mapped[datetime] = created_col()
    updated_at: Mapped[datetime] = updated_col()
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ApplicationSetting(Base):
    __tablename__ = "application_settings"

    key: Mapped[str] = mapped_column(String(80), primary_key=True)
    value: Mapped[dict] = mapped_column(JSONB, nullable=False)
    updated_at: Mapped[datetime] = updated_col()
    updated_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )


class AuditLog(Base):
    """Security / administration audit trail (user management, authentication, proof deletion)."""

    __tablename__ = "audit_logs"
    __table_args__ = (Index("ix_audit_logs_created", "created_at"), Index("ix_audit_logs_entity", "entity_type", "entity_id"))

    id: Mapped[uuid.UUID] = uuid_pk()
    actor_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"))
    action: Mapped[str] = mapped_column(String(60), nullable=False)
    entity_type: Mapped[str | None] = mapped_column(String(40))
    entity_id: Mapped[str | None] = mapped_column(String(64))
    details: Mapped[dict] = mapped_column("metadata", JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    ip_address: Mapped[str | None] = mapped_column(INET)
    created_at: Mapped[datetime] = created_col()


class LoginAttempt(Base):
    __tablename__ = "login_attempts"
    __table_args__ = (
        Index("ix_login_attempts_email_time", "email", "created_at"),
        Index("ix_login_attempts_ip_time", "ip_address", "created_at"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    email: Mapped[str] = mapped_column(String(254), nullable=False)
    ip_address: Mapped[str | None] = mapped_column(String(64))
    succeeded: Mapped[bool] = mapped_column(Boolean, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


_ = Text
