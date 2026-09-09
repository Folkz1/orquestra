"""Painel de Regência como quartel-general: placar por projeto e o ciclo aberto→respondido→executado

Revision ID: 027_painel_qg
Revises: 026_painel_regencia
Create Date: 2026-09-09

Adendo do Diego (09/09 ~19:1xZ): o painel é o QG da casa, alimentado por JSON simples. Isto acrescenta
o que faltava para o ciclo fechar sem ninguém procurar em inbox: quem respondeu, quando foi executado e
com que prova, o carimbo de idempotência de quem escreve por ficheiro, e o placar por projeto.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, TIMESTAMP

revision = "027_painel_qg"
down_revision = "026_painel_regencia"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("painel_gates", sa.Column("respondido_por", sa.String(80), nullable=True))
    op.add_column("painel_gates", sa.Column("executado_em", TIMESTAMP(timezone=True), nullable=True))
    op.add_column("painel_gates", sa.Column("executado_prova", sa.Text, nullable=True))
    # carimbo da FONTE (o "atualizado" do ficheiro JSON), para o watcher não reenviar o que não mudou
    op.add_column("painel_gates", sa.Column("fonte_atualizado", TIMESTAMP(timezone=True), nullable=True))

    op.create_table(
        "painel_placar",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("projeto", sa.String(64), nullable=False),
        sa.Column("dono", sa.String(160), nullable=True),
        sa.Column("estado", sa.Text, nullable=True),
        sa.Column("proximo", sa.Text, nullable=True),
        sa.Column("prazo", sa.String(120), nullable=True),
        sa.Column("gate", sa.String(200), nullable=True),
        sa.Column("medido_em", TIMESTAMP(timezone=True), nullable=False),
        sa.Column("fonte", sa.String(120), nullable=True),
        sa.Column("extra", JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("criado_em", TIMESTAMP(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("projeto", "medido_em", name="uq_painel_placar_projeto_medido"),
    )
    op.create_index("ix_painel_placar_projeto", "painel_placar", ["projeto"])
    op.create_index("ix_painel_placar_medido", "painel_placar", ["medido_em"])


def downgrade() -> None:
    op.drop_index("ix_painel_placar_medido", table_name="painel_placar")
    op.drop_index("ix_painel_placar_projeto", table_name="painel_placar")
    op.drop_table("painel_placar")
    op.drop_column("painel_gates", "fonte_atualizado")
    op.drop_column("painel_gates", "executado_prova")
    op.drop_column("painel_gates", "executado_em")
    op.drop_column("painel_gates", "respondido_por")
