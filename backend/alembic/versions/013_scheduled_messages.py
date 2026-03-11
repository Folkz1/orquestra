"""013 - Scheduled WhatsApp messages

Revision ID: 013_scheduled_messages
Revises: 012_contact_crm_fields
Create Date: 2026-03-11

Adds scheduled_messages table for sending WhatsApp messages at specific times
via Evolution API, processed by APScheduler every minute.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, TIMESTAMP

revision = "013_scheduled_messages"
down_revision = "012_contact_crm_fields"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "scheduled_messages",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("phone", sa.String(20), nullable=False),
        sa.Column("message_text", sa.Text(), nullable=False),
        sa.Column("scheduled_for", TIMESTAMP(timezone=True), nullable=False),
        sa.Column("status", sa.String(20), server_default="pending", nullable=False),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("evolution_instance", sa.String(100), nullable=True),
        sa.Column("contact_id", UUID(as_uuid=True), sa.ForeignKey("contacts.id", ondelete="SET NULL"), nullable=True),
        sa.Column("project_id", UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="SET NULL"), nullable=True),
        sa.Column("metadata_json", sa.dialects.postgresql.JSONB(), server_default="{}", nullable=False),
        sa.Column("sent_at", TIMESTAMP(timezone=True), nullable=True),
        sa.Column("created_at", TIMESTAMP(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", TIMESTAMP(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_index("idx_scheduled_messages_status_time", "scheduled_messages", ["status", "scheduled_for"])
    op.create_index("idx_scheduled_messages_phone", "scheduled_messages", ["phone"])


def downgrade():
    op.drop_index("idx_scheduled_messages_phone")
    op.drop_index("idx_scheduled_messages_status_time")
    op.drop_table("scheduled_messages")
