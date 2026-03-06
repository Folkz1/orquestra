"""005 - Add credentials JSONB to projects

Revision ID: 005_project_credentials
Revises: 004_contact_ignored
Create Date: 2026-03-05

Adds JSONB 'credentials' column to projects table.
Stores per-project secrets: easypanel, github, database, APIs, etc.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

# revision identifiers
revision = "005_project_credentials"
down_revision = "004_contact_ignored"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "projects",
        sa.Column("credentials", JSONB, server_default="{}", nullable=False),
    )


def downgrade() -> None:
    op.drop_column("projects", "credentials")
