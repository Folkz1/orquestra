"""004 - Add ignored flag to contacts

Revision ID: 004_contact_ignored
Revises: 003_enable_vector_memory
Create Date: 2026-03-04

Adds boolean 'ignored' column to contacts table.
When ignored=true, messages from this contact are not stored in vector memory.
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers
revision = "004_contact_ignored"
down_revision = "003_enable_vector_memory"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "contacts",
        sa.Column("ignored", sa.Boolean(), server_default="false", nullable=False),
    )


def downgrade() -> None:
    op.drop_column("contacts", "ignored")
