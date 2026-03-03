"""001 - Initial schema: contacts, messages, recordings, projects, daily_briefs

Revision ID: 001_initial
Revises:
Create Date: 2026-03-03

IMPORTANT: Uses CAST(x AS uuid) syntax, NEVER ::uuid (asyncpg incompatibility)
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID, TIMESTAMP

# revision identifiers
revision = "001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ─── Projects ─────────────────────────────────────────────────────
    op.create_table(
        "projects",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            primary_key=True,
        ),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("status", sa.String(20), server_default="active", nullable=False),
        sa.Column("color", sa.String(7), server_default="#3b82f6", nullable=False),
        sa.Column(
            "keywords",
            sa.ARRAY(sa.String()),
            server_default="{}",
        ),
        sa.Column(
            "created_at",
            TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )

    # ─── Contacts ─────────────────────────────────────────────────────
    op.create_table(
        "contacts",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            primary_key=True,
        ),
        sa.Column("phone", sa.String(20), nullable=False, unique=True),
        sa.Column("name", sa.String(255), nullable=True),
        sa.Column("push_name", sa.String(255), nullable=True),
        sa.Column("profile_pic_url", sa.Text(), nullable=True),
        sa.Column(
            "tags",
            sa.ARRAY(sa.String()),
            server_default="{}",
        ),
        sa.Column(
            "project_id",
            UUID(as_uuid=True),
            sa.ForeignKey("projects.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("is_group", sa.Boolean(), server_default="false", nullable=False),
        sa.Column(
            "created_at",
            TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )

    op.create_index("ix_contacts_phone", "contacts", ["phone"])
    op.create_index("ix_contacts_project_id", "contacts", ["project_id"])

    # ─── Messages ─────────────────────────────────────────────────────
    op.create_table(
        "messages",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            primary_key=True,
        ),
        sa.Column(
            "contact_id",
            UUID(as_uuid=True),
            sa.ForeignKey("contacts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("remote_jid", sa.String(100), nullable=False),
        sa.Column("direction", sa.String(10), nullable=False),
        sa.Column("message_type", sa.String(20), nullable=False),
        sa.Column("content", sa.Text(), nullable=True),
        sa.Column("transcription", sa.Text(), nullable=True),
        sa.Column("media_url", sa.Text(), nullable=True),
        sa.Column("media_local_path", sa.Text(), nullable=True),
        sa.Column("media_mimetype", sa.String(100), nullable=True),
        sa.Column("media_duration_seconds", sa.Integer(), nullable=True),
        sa.Column(
            "quoted_message_id",
            UUID(as_uuid=True),
            sa.ForeignKey("messages.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("evolution_message_id", sa.String(100), nullable=True),
        sa.Column("raw_payload", JSONB(), nullable=True),
        sa.Column(
            "processed", sa.Boolean(), server_default="false", nullable=False
        ),
        sa.Column(
            "project_id",
            UUID(as_uuid=True),
            sa.ForeignKey("projects.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("timestamp", TIMESTAMP(timezone=True), nullable=False),
        sa.Column(
            "created_at",
            TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )

    op.create_index("ix_messages_contact_id", "messages", ["contact_id"])
    op.create_index(
        "ix_messages_timestamp_desc",
        "messages",
        [sa.text("timestamp DESC")],
    )
    op.create_index("ix_messages_project_id", "messages", ["project_id"])
    op.create_index("ix_messages_message_type", "messages", ["message_type"])
    op.create_index(
        "ix_messages_unprocessed",
        "messages",
        ["processed"],
        postgresql_where=sa.text("processed = FALSE"),
    )

    # Full-text search GIN index on messages content (Portuguese config)
    op.execute(
        """
        CREATE INDEX ix_messages_content_fts
        ON messages
        USING GIN (to_tsvector('portuguese', COALESCE(content, '') || ' ' || COALESCE(transcription, '')))
        """
    )

    # ─── Recordings ───────────────────────────────────────────────────
    op.create_table(
        "recordings",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            primary_key=True,
        ),
        sa.Column("title", sa.String(500), nullable=True),
        sa.Column("source", sa.String(20), server_default="pwa", nullable=False),
        sa.Column("file_path", sa.Text(), nullable=False),
        sa.Column("file_size_bytes", sa.BigInteger(), nullable=True),
        sa.Column("duration_seconds", sa.Integer(), nullable=True),
        sa.Column("transcription", sa.Text(), nullable=True),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("action_items", JSONB(), server_default="[]"),
        sa.Column("decisions", JSONB(), server_default="[]"),
        sa.Column(
            "key_topics",
            sa.ARRAY(sa.String()),
            server_default="{}",
        ),
        sa.Column(
            "project_id",
            UUID(as_uuid=True),
            sa.ForeignKey("projects.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "processed", sa.Boolean(), server_default="false", nullable=False
        ),
        sa.Column(
            "recorded_at",
            TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )

    op.create_index("ix_recordings_project_id", "recordings", ["project_id"])
    op.create_index(
        "ix_recordings_recorded_at_desc",
        "recordings",
        [sa.text("recorded_at DESC")],
    )

    # ─── Daily Briefs ─────────────────────────────────────────────────
    op.create_table(
        "daily_briefs",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            primary_key=True,
        ),
        sa.Column("date", sa.Date(), nullable=False, unique=True),
        sa.Column("period_start", TIMESTAMP(timezone=True), nullable=False),
        sa.Column("period_end", TIMESTAMP(timezone=True), nullable=False),
        sa.Column(
            "total_messages", sa.Integer(), server_default="0", nullable=False
        ),
        sa.Column(
            "total_recordings", sa.Integer(), server_default="0", nullable=False
        ),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("pending_actions", JSONB(), server_default="[]"),
        sa.Column("decisions_made", JSONB(), server_default="[]"),
        sa.Column("key_insights", JSONB(), server_default="[]"),
        sa.Column(
            "projects_mentioned",
            sa.ARRAY(sa.String()),
            server_default="{}",
        ),
        sa.Column("raw_context", sa.Text(), nullable=True),
        sa.Column("model_used", sa.String(100), nullable=True),
        sa.Column(
            "sent_telegram", sa.Boolean(), server_default="false", nullable=False
        ),
        sa.Column(
            "sent_whatsapp", sa.Boolean(), server_default="false", nullable=False
        ),
        sa.Column(
            "generated_at",
            TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_table("daily_briefs")
    op.drop_table("recordings")
    op.execute("DROP INDEX IF EXISTS ix_messages_content_fts")
    op.drop_table("messages")
    op.drop_table("contacts")
    op.drop_table("projects")
