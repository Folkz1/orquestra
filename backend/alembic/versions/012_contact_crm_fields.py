"""012 - Add CRM/post-sale fields to contacts

Revision ID: 012_contact_crm_fields
Revises: 011_proposal_analytics
Create Date: 2026-03-09

Adds pipeline management, financial tracking, and engagement fields
to support full CRM lifecycle on the contacts table.
"""

from alembic import op
import sqlalchemy as sa

revision = "012_contact_crm_fields"
down_revision = "011_proposal_analytics"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "contacts",
        sa.Column("pipeline_stage", sa.String(30), server_default="lead", nullable=False),
    )
    op.add_column(
        "contacts",
        sa.Column("company", sa.String(255), nullable=True),
    )
    op.add_column(
        "contacts",
        sa.Column("email", sa.String(255), nullable=True),
    )
    op.add_column(
        "contacts",
        sa.Column("engagement_score", sa.Integer(), server_default="0", nullable=False),
    )
    op.add_column(
        "contacts",
        sa.Column("last_contacted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "contacts",
        sa.Column("next_action", sa.Text(), nullable=True),
    )
    op.add_column(
        "contacts",
        sa.Column("next_action_date", sa.Date(), nullable=True),
    )
    op.add_column(
        "contacts",
        sa.Column("monthly_revenue", sa.String(50), nullable=True),
    )
    op.add_column(
        "contacts",
        sa.Column("total_revenue", sa.String(50), nullable=True),
    )
    op.add_column(
        "contacts",
        sa.Column("acquired_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "contacts",
        sa.Column("support_ends_at", sa.DateTime(timezone=True), nullable=True),
    )

    op.create_index("ix_contacts_pipeline_stage", "contacts", ["pipeline_stage"])
    op.create_index("ix_contacts_engagement_score", "contacts", ["engagement_score"])


def downgrade() -> None:
    op.drop_index("ix_contacts_engagement_score", table_name="contacts")
    op.drop_index("ix_contacts_pipeline_stage", table_name="contacts")

    op.drop_column("contacts", "support_ends_at")
    op.drop_column("contacts", "acquired_at")
    op.drop_column("contacts", "total_revenue")
    op.drop_column("contacts", "monthly_revenue")
    op.drop_column("contacts", "next_action_date")
    op.drop_column("contacts", "next_action")
    op.drop_column("contacts", "last_contacted_at")
    op.drop_column("contacts", "engagement_score")
    op.drop_column("contacts", "email")
    op.drop_column("contacts", "company")
    op.drop_column("contacts", "pipeline_stage")
