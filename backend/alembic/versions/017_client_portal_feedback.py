"""Add feedback workflow fields to client portal links

Revision ID: 017_client_portal_feedback
Revises: 016_delivery_reports
Create Date: 2026-03-12
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "017_client_portal_feedback"
down_revision = "016_delivery_reports"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "client_portal_links",
        sa.Column(
            "contact_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("contacts.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column(
        "client_portal_links",
        sa.Column("feedback_status", sa.String(length=20), server_default="idle", nullable=False),
    )
    op.add_column(
        "client_portal_links",
        sa.Column("feedback_type", sa.String(length=20), server_default="feedback", nullable=False),
    )
    op.add_column(
        "client_portal_links",
        sa.Column("feedback_title", sa.String(length=255), nullable=True),
    )
    op.add_column(
        "client_portal_links",
        sa.Column("feedback_message", sa.Text(), nullable=True),
    )
    op.add_column(
        "client_portal_links",
        sa.Column("feedback_requested_at", postgresql.TIMESTAMP(timezone=True), nullable=True),
    )
    op.add_column(
        "client_portal_links",
        sa.Column("feedback_sent_at", postgresql.TIMESTAMP(timezone=True), nullable=True),
    )
    op.add_column(
        "client_portal_links",
        sa.Column("feedback_completed_at", postgresql.TIMESTAMP(timezone=True), nullable=True),
    )
    op.add_column(
        "client_portal_links",
        sa.Column(
            "updated_at",
            postgresql.TIMESTAMP(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_column("client_portal_links", "updated_at")
    op.drop_column("client_portal_links", "feedback_completed_at")
    op.drop_column("client_portal_links", "feedback_sent_at")
    op.drop_column("client_portal_links", "feedback_requested_at")
    op.drop_column("client_portal_links", "feedback_message")
    op.drop_column("client_portal_links", "feedback_title")
    op.drop_column("client_portal_links", "feedback_type")
    op.drop_column("client_portal_links", "feedback_status")
    op.drop_column("client_portal_links", "contact_id")
