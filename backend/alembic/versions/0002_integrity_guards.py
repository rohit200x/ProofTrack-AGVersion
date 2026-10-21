"""Integrity guards: proof preview column, append-only event log, immutable proof evidence,
and the DELIVERED-requires-stored-proof invariant enforced inside PostgreSQL.

Revision ID: 0002_integrity_guards
Revises: eb547e268e81
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0002_integrity_guards"
down_revision: Union[str, Sequence[str], None] = "eb547e268e81"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("delivery_proofs", sa.Column("preview_key", sa.String(length=300), nullable=True))
    op.create_unique_constraint("uq_delivery_proofs_preview_key", "delivery_proofs", ["preview_key"])
    op.create_index("ix_deliveries_created_at", "deliveries", ["created_at"])
    op.create_index("ix_deliveries_delivered_at", "deliveries", ["delivered_at"])

    # 1) delivery_events is append-only.
    op.execute(
        """
        CREATE OR REPLACE FUNCTION pt_forbid_event_mutation() RETURNS trigger AS $$
        BEGIN
            RAISE EXCEPTION 'delivery_events is append-only (% not permitted)', TG_OP
                USING ERRCODE = 'insufficient_privilege';
        END;
        $$ LANGUAGE plpgsql;
        CREATE TRIGGER trg_delivery_events_append_only
            BEFORE UPDATE OR DELETE ON delivery_events
            FOR EACH ROW EXECUTE FUNCTION pt_forbid_event_mutation();
        """
    )

    # 2) Proof evidence is immutable: rows cannot be deleted, and the evidence columns cannot change.
    #    Review state and (admin) soft-deletion metadata may change.
    op.execute(
        """
        CREATE OR REPLACE FUNCTION pt_guard_proof_mutation() RETURNS trigger AS $$
        BEGIN
            IF TG_OP = 'DELETE' THEN
                RAISE EXCEPTION 'delivery_proofs rows cannot be deleted; use administrative soft deletion'
                    USING ERRCODE = 'insufficient_privilege';
            END IF;
            IF NEW.delivery_id IS DISTINCT FROM OLD.delivery_id
               OR NEW.uploader_id IS DISTINCT FROM OLD.uploader_id
               OR NEW.kind IS DISTINCT FROM OLD.kind
               OR NEW.object_key IS DISTINCT FROM OLD.object_key
               OR NEW.thumbnail_key IS DISTINCT FROM OLD.thumbnail_key
               OR NEW.preview_key IS DISTINCT FROM OLD.preview_key
               OR NEW.sha256 IS DISTINCT FROM OLD.sha256
               OR NEW.content_type IS DISTINCT FROM OLD.content_type
               OR NEW.size_bytes IS DISTINCT FROM OLD.size_bytes
               OR NEW.uploaded_at IS DISTINCT FROM OLD.uploaded_at
               OR NEW.latitude IS DISTINCT FROM OLD.latitude
               OR NEW.longitude IS DISTINCT FROM OLD.longitude THEN
                RAISE EXCEPTION 'proof evidence fields are immutable'
                    USING ERRCODE = 'insufficient_privilege';
            END IF;
            IF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
                RAISE EXCEPTION 'proof deletion cannot be reversed or altered'
                    USING ERRCODE = 'insufficient_privilege';
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        CREATE TRIGGER trg_delivery_proofs_immutable
            BEFORE UPDATE OR DELETE ON delivery_proofs
            FOR EACH ROW EXECUTE FUNCTION pt_guard_proof_mutation();
        """
    )

    # 3) Critical business invariant: a delivery may only be DELIVERED if a committed, non-deleted
    #    DELIVERY proof exists. Deferred so the proof row and status change can be written in the same
    #    transaction in any order; checked at COMMIT.
    op.execute(
        """
        CREATE OR REPLACE FUNCTION pt_check_delivered_has_proof() RETURNS trigger AS $$
        BEGIN
            IF NEW.status = 'DELIVERED' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'DELIVERED') THEN
                IF NOT EXISTS (
                    SELECT 1 FROM delivery_proofs p
                    WHERE p.delivery_id = NEW.id AND p.kind = 'DELIVERY' AND p.deleted_at IS NULL
                ) THEN
                    RAISE EXCEPTION 'delivery % cannot be DELIVERED without a stored proof photograph', NEW.reference
                        USING ERRCODE = 'check_violation';
                END IF;
            END IF;
            RETURN NULL;
        END;
        $$ LANGUAGE plpgsql;
        CREATE CONSTRAINT TRIGGER trg_deliveries_delivered_requires_proof
            AFTER INSERT OR UPDATE OF status ON deliveries
            DEFERRABLE INITIALLY DEFERRED
            FOR EACH ROW EXECUTE FUNCTION pt_check_delivered_has_proof();
        """
    )

    # Default organisation settings (admins edit via the Settings screen).
    op.execute(
        """
        INSERT INTO application_settings (key, value) VALUES
            ('business_timezone', '"America/Chicago"'::jsonb),
            ('proof_retention_days', '365'::jsonb)
        ON CONFLICT (key) DO NOTHING;
        """
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS trg_deliveries_delivered_requires_proof ON deliveries")
    op.execute("DROP FUNCTION IF EXISTS pt_check_delivered_has_proof()")
    op.execute("DROP TRIGGER IF EXISTS trg_delivery_proofs_immutable ON delivery_proofs")
    op.execute("DROP FUNCTION IF EXISTS pt_guard_proof_mutation()")
    op.execute("DROP TRIGGER IF EXISTS trg_delivery_events_append_only ON delivery_events")
    op.execute("DROP FUNCTION IF EXISTS pt_forbid_event_mutation()")
    op.drop_index("ix_deliveries_delivered_at", table_name="deliveries")
    op.drop_index("ix_deliveries_created_at", table_name="deliveries")
    op.drop_constraint("uq_delivery_proofs_preview_key", "delivery_proofs", type_="unique")
    op.drop_column("delivery_proofs", "preview_key")
