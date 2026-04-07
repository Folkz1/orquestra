"""add testing tables

Revision ID: 025_add_testing_tables
Revises: 024_community_app
Create Date: 2026-04-07

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID, TIMESTAMP

revision = "025_add_testing_tables"
down_revision = "024_community_app"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # testers
    op.create_table(
        "testers",
        sa.Column("id", UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column("nome", sa.String(255), nullable=False),
        sa.Column("whatsapp", sa.String(50), nullable=False),
        sa.Column("token", sa.String(128), nullable=False, unique=True),
        sa.Column("ativo", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("criado_em", TIMESTAMP(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_testers_token", "testers", ["token"], unique=True)

    # test_plans
    op.create_table(
        "test_plans",
        sa.Column("id", UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column("projeto", sa.String(100), nullable=False),
        sa.Column("nome", sa.String(255), nullable=False),
        sa.Column("descricao", sa.Text(), nullable=True),
        sa.Column("perfil", sa.String(100), nullable=False),
        sa.Column("steps", JSONB, server_default=sa.text("'[]'::jsonb"), nullable=False),
        sa.Column("criado_por", sa.String(100), nullable=True),
        sa.Column("criado_em", TIMESTAMP(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_test_plans_projeto", "test_plans", ["projeto"])

    # test_sessions
    op.create_table(
        "test_sessions",
        sa.Column("id", UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column("plan_id", UUID(as_uuid=True), sa.ForeignKey("test_plans.id", ondelete="CASCADE"), nullable=False),
        sa.Column("tester_id", UUID(as_uuid=True), sa.ForeignKey("testers.id", ondelete="SET NULL"), nullable=True),
        sa.Column("status", sa.String(20), server_default=sa.text("'pendente'"), nullable=False),
        sa.Column("link_token", sa.String(128), nullable=False, unique=True),
        sa.Column("enviado_em", TIMESTAMP(timezone=True), nullable=True),
        sa.Column("iniciado_em", TIMESTAMP(timezone=True), nullable=True),
        sa.Column("concluido_em", TIMESTAMP(timezone=True), nullable=True),
        sa.Column("criado_em", TIMESTAMP(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_test_sessions_link_token", "test_sessions", ["link_token"], unique=True)
    op.create_index("ix_test_sessions_plan_id", "test_sessions", ["plan_id"])

    # test_results
    op.create_table(
        "test_results",
        sa.Column("id", UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column("session_id", UUID(as_uuid=True), sa.ForeignKey("test_sessions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("step_id", sa.String(50), nullable=False),
        sa.Column("status", sa.String(10), nullable=False),  # pass | fail | skip
        sa.Column("comentario", sa.Text(), nullable=True),
        sa.Column("screenshot_url", sa.String(500), nullable=True),
        sa.Column("criado_em", TIMESTAMP(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_test_results_session_id", "test_results", ["session_id"])


def downgrade() -> None:
    op.drop_index("ix_test_results_session_id", "test_results")
    op.drop_table("test_results")
    op.drop_index("ix_test_sessions_link_token", "test_sessions")
    op.drop_index("ix_test_sessions_plan_id", "test_sessions")
    op.drop_table("test_sessions")
    op.drop_index("ix_test_plans_projeto", "test_plans")
    op.drop_table("test_plans")
    op.drop_index("ix_testers_token", "testers")
    op.drop_table("testers")
