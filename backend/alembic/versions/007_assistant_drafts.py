"""007 - assistant drafts for owner-controlled WhatsApp copilot

Revision ID: 007_assistant_drafts
Revises: 006_project_tasks
Create Date: 2026-03-08
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

# revision identifiers
revision = "007_assistant_drafts"
down_revision = "006_project_tasks"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "assistant_drafts",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column("contact_id", sa.UUID(), sa.ForeignKey("contacts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("based_on_message_id", sa.UUID(), sa.ForeignKey("messages.id", ondelete="SET NULL"), nullable=True),
        sa.Column("objective", sa.Text(), nullable=True),
        sa.Column("draft_text", sa.Text(), nullable=False),
        sa.Column("status", sa.String(20), server_default="generated", nullable=False),
        sa.Column("metadata_json", JSONB, server_default="{}", nullable=False),
        sa.Column("sent_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_assistant_drafts_contact_id", "assistant_drafts", ["contact_id"])
    op.create_index("ix_assistant_drafts_status", "assistant_drafts", ["status"])


def downgrade() -> None:
    op.drop_index("ix_assistant_drafts_status")
    op.drop_index("ix_assistant_drafts_contact_id")
    op.drop_table("assistant_drafts")
