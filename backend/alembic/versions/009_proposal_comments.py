"""009 - proposal comments for client feedback

Revision ID: 009_proposal_comments
Revises: 008_proposals
Create Date: 2026-03-09
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers
revision = "009_proposal_comments"
down_revision = "008_proposals"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "proposal_comments",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column("proposal_id", sa.UUID(), sa.ForeignKey("proposals.id", ondelete="CASCADE"), nullable=False),
        sa.Column("author_name", sa.String(255), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_proposal_comments_proposal_id", "proposal_comments", ["proposal_id"])


def downgrade() -> None:
    op.drop_index("ix_proposal_comments_proposal_id")
    op.drop_table("proposal_comments")
