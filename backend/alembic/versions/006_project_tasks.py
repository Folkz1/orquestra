"""006 - Project Tasks table for Kanban

Revision ID: 006_project_tasks
Revises: 005_project_credentials
Create Date: 2026-03-06

Adds project_tasks table for tracking task status per project.
Columns: backlog -> in_progress -> review -> done
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

# revision identifiers
revision = "006_project_tasks"
down_revision = "005_project_credentials"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "project_tasks",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column("project_id", sa.UUID(), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=True),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("status", sa.String(20), server_default="backlog", nullable=False),
        sa.Column("priority", sa.String(10), server_default="medium", nullable=False),
        sa.Column("source", sa.String(20), server_default="manual", nullable=False),
        sa.Column("assigned_to", sa.String(20), server_default="claude", nullable=False),
        sa.Column("metadata_json", JSONB, server_default="{}", nullable=False),
        sa.Column("completed_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_project_tasks_project_id", "project_tasks", ["project_id"])
    op.create_index("ix_project_tasks_status", "project_tasks", ["status"])


def downgrade() -> None:
    op.drop_index("ix_project_tasks_status")
    op.drop_index("ix_project_tasks_project_id")
    op.drop_table("project_tasks")
