"""Newsletter - subscribers + editions para GuyFolkz newsletter

Revision ID: 022_newsletter
Revises: 021_subscriptions
Create Date: 2026-03-20
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB, TIMESTAMP

revision = "022_newsletter"
down_revision = "021_subscriptions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "newsletter_subscribers",
        sa.Column("id", UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column("email", sa.String(320), nullable=False, unique=True),
        sa.Column("name", sa.String(200), nullable=True),
        sa.Column("source", sa.String(100), server_default="website"),  # website, youtube, whatsapp
        sa.Column("status", sa.String(20), server_default="active"),  # active, unsubscribed
        sa.Column("metadata_json", JSONB, nullable=True),
        sa.Column("created_at", TIMESTAMP(timezone=True), server_default=sa.func.now()),
        sa.Column("unsubscribed_at", TIMESTAMP(timezone=True), nullable=True),
    )
    op.create_index("ix_newsletter_subscribers_email", "newsletter_subscribers", ["email"], unique=True)
    op.create_index("ix_newsletter_subscribers_status", "newsletter_subscribers", ["status"])

    op.create_table(
        "newsletter_editions",
        sa.Column("id", UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("content_html", sa.Text, nullable=False),
        sa.Column("content_text", sa.Text, nullable=True),  # plaintext fallback
        sa.Column("status", sa.String(20), server_default="draft"),  # draft, sent
        sa.Column("sent_count", sa.Integer, server_default="0"),
        sa.Column("youtube_video_id", sa.String(50), nullable=True),
        sa.Column("metadata_json", JSONB, nullable=True),
        sa.Column("created_at", TIMESTAMP(timezone=True), server_default=sa.func.now()),
        sa.Column("sent_at", TIMESTAMP(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("newsletter_editions")
    op.drop_table("newsletter_subscribers")
