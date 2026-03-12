"""Client portal links for project tracking

Revision ID: 015_client_portal_links
Revises: 014_client_creds
Create Date: 2026-03-11
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "015_client_portal_links"
down_revision = "014_client_creds"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "client_portal_links",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            primary_key=True,
        ),
        sa.Column(
            "project_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("token", sa.String(64), unique=True, nullable=False),
        sa.Column("client_name", sa.String(255), nullable=False),
        sa.Column(
            "visible_sections",
            postgresql.JSONB,
            server_default='["tasks","timeline","proposals","recordings"]',
            nullable=False,
        ),
        sa.Column("welcome_message", sa.Text, nullable=True),
        sa.Column("is_active", sa.Boolean, server_default="true", nullable=False),
        sa.Column("last_viewed_at", postgresql.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("view_count", sa.Integer, server_default="0", nullable=False),
        sa.Column("expires_at", postgresql.TIMESTAMP(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            postgresql.TIMESTAMP(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_table("client_portal_links")
