"""008 - proposals table for shareable commercial proposals

Revision ID: 008_proposals
Revises: 007_assistant_drafts
Create Date: 2026-03-09
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

# revision identifiers
revision = "008_proposals"
down_revision = "007_assistant_drafts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "proposals",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column("slug", sa.String(255), nullable=False, unique=True),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("client_name", sa.String(255), nullable=False),
        sa.Column("client_phone", sa.String(20), nullable=True),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("status", sa.String(20), server_default="draft", nullable=False),
        sa.Column("total_value", sa.String(50), nullable=True),
        sa.Column("metadata_json", JSONB, server_default="{}", nullable=False),
        sa.Column("viewed_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("accepted_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_proposals_slug", "proposals", ["slug"], unique=True)
    op.create_index("ix_proposals_status", "proposals", ["status"])


def downgrade() -> None:
    op.drop_index("ix_proposals_status")
    op.drop_index("ix_proposals_slug")
    op.drop_table("proposals")
