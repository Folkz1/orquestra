"""Add WhatsApp chat denormalization and push subscriptions

Revision ID: 018_whatsapp_pwa_chat
Revises: 017_client_portal_feedback
Create Date: 2026-03-12
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "018_whatsapp_pwa_chat"
down_revision = "017_client_portal_feedback"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "contacts",
        sa.Column("unread_count", sa.Integer(), server_default="0", nullable=False),
    )
    op.add_column(
        "contacts",
        sa.Column("last_message_preview", sa.Text(), nullable=True),
    )
    op.add_column(
        "contacts",
        sa.Column("last_message_at", postgresql.TIMESTAMP(timezone=True), nullable=True),
    )

    op.create_table(
        "push_subscriptions",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            primary_key=True,
        ),
        sa.Column("endpoint", sa.Text(), nullable=False, unique=True),
        sa.Column("p256dh", sa.Text(), nullable=False),
        sa.Column("auth", sa.Text(), nullable=False),
        sa.Column("user_agent", sa.Text(), nullable=True),
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
        sa.Column(
            "last_seen_at",
            postgresql.TIMESTAMP(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )

    op.execute(
        """
        UPDATE contacts AS c
        SET
            last_message_at = latest.timestamp,
            last_message_preview = latest.preview
        FROM (
            SELECT DISTINCT ON (m.contact_id)
                m.contact_id,
                m.timestamp,
                CASE
                    WHEN COALESCE(NULLIF(BTRIM(m.content), ''), NULLIF(BTRIM(m.transcription), '')) IS NOT NULL
                        THEN LEFT(COALESCE(NULLIF(BTRIM(m.content), ''), NULLIF(BTRIM(m.transcription), '')), 180)
                    ELSE '[' || UPPER(COALESCE(m.message_type, 'mensagem')) || ']'
                END AS preview
            FROM messages AS m
            ORDER BY m.contact_id, m.timestamp DESC, m.created_at DESC
        ) AS latest
        WHERE latest.contact_id = c.id
        """
    )


def downgrade() -> None:
    op.drop_table("push_subscriptions")
    op.drop_column("contacts", "last_message_at")
    op.drop_column("contacts", "last_message_preview")
    op.drop_column("contacts", "unread_count")
