"""Delivery reports comparing proposal vs delivered scope

Revision ID: 016_delivery_reports
Revises: 015_client_portal_links
Create Date: 2026-03-12
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "016_delivery_reports"
down_revision = "015_client_portal_links"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "delivery_reports",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            primary_key=True,
        ),
        sa.Column(
            "proposal_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("proposals.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column(
            "contact_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("contacts.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("proposed_scope", postgresql.JSONB, server_default="[]", nullable=False),
        sa.Column("delivered_scope", postgresql.JSONB, server_default="[]", nullable=False),
        sa.Column("extras", postgresql.JSONB, server_default="[]", nullable=False),
        sa.Column("financial_summary", postgresql.JSONB, server_default="{}", nullable=False),
        sa.Column("comparison_analysis", sa.Text, nullable=True),
        sa.Column("status", sa.String(20), server_default="draft", nullable=False),
        sa.Column(
            "generated_at",
            postgresql.TIMESTAMP(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            postgresql.TIMESTAMP(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            postgresql.TIMESTAMP(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_delivery_reports_contact_id",
        "delivery_reports",
        ["contact_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_delivery_reports_contact_id", table_name="delivery_reports")
    op.drop_table("delivery_reports")
