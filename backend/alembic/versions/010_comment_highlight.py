"""010 - add highlighted_text to proposal comments

Revision ID: 010_comment_highlight
Revises: 009_proposal_comments
Create Date: 2026-03-09
"""

from alembic import op
import sqlalchemy as sa

revision = "010_comment_highlight"
down_revision = "009_proposal_comments"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("proposal_comments", sa.Column("highlighted_text", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("proposal_comments", "highlighted_text")
