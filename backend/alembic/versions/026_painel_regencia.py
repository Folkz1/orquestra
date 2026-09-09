"""Painel de Regência — gates, telemetria das contas (série) e KPIs por frente/dia

Revision ID: 026_painel_regencia
Revises: 025_add_testing_tables
Create Date: 2026-09-09
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, TIMESTAMP

revision = "026_painel_regencia"
down_revision = "025_add_testing_tables"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "painel_gates",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("projeto", sa.String(64), nullable=False),
        sa.Column("projeto_nome", sa.String(160), nullable=True),
        sa.Column("titulo", sa.Text, nullable=False),
        sa.Column("why", sa.Text, nullable=True),
        sa.Column("ctx", JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("opts", JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("rec", sa.Text, nullable=True),
        sa.Column("urg", sa.Boolean, nullable=False, server_default=sa.text("false")),
        sa.Column("estado", sa.String(16), nullable=False, server_default="aberto"),
        sa.Column("escolha", sa.String(160), nullable=True),
        sa.Column("nota", sa.Text, nullable=True),
        sa.Column("ts_aberto", TIMESTAMP(timezone=True), nullable=True),
        sa.Column("ts_resposta", TIMESTAMP(timezone=True), nullable=True),
        sa.Column("ts_expira", TIMESTAMP(timezone=True), nullable=True),
        sa.Column("origem", sa.String(80), nullable=True),
        sa.Column("extra", JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("criado_em", TIMESTAMP(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("atualizado_em", TIMESTAMP(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_painel_gates_projeto", "painel_gates", ["projeto"])
    op.create_index("ix_painel_gates_estado", "painel_gates", ["estado"])
    op.create_index("ix_painel_gates_estado_urg", "painel_gates", ["estado", "urg"])

    op.create_table(
        "painel_telemetria",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("ts", TIMESTAMP(timezone=True), nullable=False),
        sa.Column("conta", sa.String(40), nullable=False),
        sa.Column("limites", JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("usd", sa.Integer, nullable=True),
        sa.Column("nivel", sa.String(20), nullable=True),
        sa.Column("fonte", sa.String(120), nullable=False),
        sa.Column("extra", JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("criado_em", TIMESTAMP(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("ts", "conta", "fonte", name="uq_painel_telemetria_ts_conta_fonte"),
    )
    op.create_index("ix_painel_telemetria_ts", "painel_telemetria", ["ts"])
    op.create_index("ix_painel_telemetria_conta", "painel_telemetria", ["conta"])
    op.create_index("ix_painel_telemetria_conta_ts", "painel_telemetria", ["conta", "ts"])

    op.create_table(
        "painel_kpi",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("dia", sa.Date, nullable=False),
        sa.Column("frente", sa.String(80), nullable=False),
        sa.Column("metrics", JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("fonte", sa.String(120), nullable=False),
        sa.Column("criado_em", TIMESTAMP(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("atualizado_em", TIMESTAMP(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("dia", "frente", "fonte", name="uq_painel_kpi_dia_frente_fonte"),
    )
    op.create_index("ix_painel_kpi_dia", "painel_kpi", ["dia"])
    op.create_index("ix_painel_kpi_frente", "painel_kpi", ["frente"])


def downgrade() -> None:
    op.drop_index("ix_painel_kpi_frente", table_name="painel_kpi")
    op.drop_index("ix_painel_kpi_dia", table_name="painel_kpi")
    op.drop_table("painel_kpi")
    op.drop_index("ix_painel_telemetria_conta_ts", table_name="painel_telemetria")
    op.drop_index("ix_painel_telemetria_conta", table_name="painel_telemetria")
    op.drop_index("ix_painel_telemetria_ts", table_name="painel_telemetria")
    op.drop_table("painel_telemetria")
    op.drop_index("ix_painel_gates_estado_urg", table_name="painel_gates")
    op.drop_index("ix_painel_gates_estado", table_name="painel_gates")
    op.drop_index("ix_painel_gates_projeto", table_name="painel_gates")
    op.drop_table("painel_gates")
