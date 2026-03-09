"""011 - proposal analytics events table + contact_id on proposals

Revision ID: 011_proposal_analytics
Revises: 010_comment_highlight
Create Date: 2026-03-09
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB

revision = "011_proposal_analytics"
down_revision = "010_comment_highlight"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Create proposal_events table
    op.create_table(
        "proposal_events",
        sa.Column("id", UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column("proposal_id", UUID(as_uuid=True), sa.ForeignKey("proposals.id", ondelete="CASCADE"), nullable=False),
        sa.Column("contact_id", UUID(as_uuid=True), sa.ForeignKey("contacts.id", ondelete="SET NULL"), nullable=True),
        sa.Column("session_id", sa.String(100), nullable=False),
        sa.Column("event_type", sa.String(30), nullable=False),
        sa.Column("event_data", JSONB, server_default=sa.text("'{}'::jsonb")),
        sa.Column("ip_address", sa.String(45), nullable=True),
        sa.Column("user_agent", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )

    op.create_index("ix_proposal_events_proposal_id", "proposal_events", ["proposal_id"])
    op.create_index("ix_proposal_events_session_id", "proposal_events", ["session_id"])
    op.create_index("ix_proposal_events_event_type", "proposal_events", ["event_type"])
    op.create_index("ix_proposal_events_created_at", "proposal_events", ["created_at"])

    # 2. Add contact_id to proposals table
    op.add_column("proposals", sa.Column("contact_id", UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        "fk_proposals_contact_id",
        "proposals",
        "contacts",
        ["contact_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_proposals_contact_id", "proposals", ["contact_id"])


def downgrade() -> None:
    # Reverse: drop proposals.contact_id
    op.drop_index("ix_proposals_contact_id", table_name="proposals")
    op.drop_constraint("fk_proposals_contact_id", "proposals", type_="foreignkey")
    op.drop_column("proposals", "contact_id")

    # Reverse: drop proposal_events table (indexes drop automatically with table)
    op.drop_table("proposal_events")
