"""
Painel de Regência — modelos (gates, telemetria das contas Claude, KPIs por frente/dia).

Vivem num módulo próprio para não tocar em models.py (970 linhas partilhadas por todas as frentes).
Briefing: docs/briefings/painel-regencia.md. Migration: alembic/versions/026_painel_regencia.py.
"""

from sqlalchemy import (
    BigInteger,
    Boolean,
    Column,
    Date,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, TIMESTAMP
from sqlalchemy.sql import func

from app.database import Base


class PainelGate(Base):
    """Um gate do Diego: o que se pergunta, as opções com consequência, a recomendação e a resposta."""

    __tablename__ = "painel_gates"

    id = Column(String(64), primary_key=True)                     # código do gate (GD24, GSB-0909-PORTA…)
    projeto = Column(String(64), nullable=False, index=True)      # código curto (sb, lex, donna, mc, gf, casa…)
    projeto_nome = Column(String(160), nullable=True)
    titulo = Column(Text, nullable=False)
    why = Column(Text, nullable=True)                             # porque é dele (irreversível · dinheiro · cliente · direção)
    ctx = Column(JSONB, nullable=False, server_default=text("'[]'::jsonb"))   # lista de parágrafos
    opts = Column(JSONB, nullable=False, server_default=text("'[]'::jsonb"))  # lista de [letra, rótulo, consequência]
    rec = Column(Text, nullable=True)
    urg = Column(Boolean, nullable=False, server_default=text("false"))
    estado = Column(String(16), nullable=False, server_default="aberto", index=True)  # aberto | respondido | expirado
    escolha = Column(String(160), nullable=True)
    nota = Column(Text, nullable=True)
    ts_aberto = Column(TIMESTAMP(timezone=True), nullable=True)   # nulo = não medido (a Mesa nunca guardou)
    ts_resposta = Column(TIMESTAMP(timezone=True), nullable=True)
    ts_expira = Column(TIMESTAMP(timezone=True), nullable=True)   # declarado por quem abre; GET calcula "expirado"
    origem = Column(String(80), nullable=True)                    # mesa-html | mesa-db | mesa-decisao | regencia | api
    extra = Column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    criado_em = Column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)
    atualizado_em = Column(TIMESTAMP(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class PainelTelemetria(Base):
    """Uma linha por leitura e por conta. É a série: nunca se sobrescreve, só se acrescenta."""

    __tablename__ = "painel_telemetria"
    __table_args__ = (
        UniqueConstraint("ts", "conta", "fonte", name="uq_painel_telemetria_ts_conta_fonte"),
    )

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    ts = Column(TIMESTAMP(timezone=True), nullable=False, index=True)
    conta = Column(String(40), nullable=False, index=True)        # nome (Diego, Eduardo), nunca o e-mail
    limites = Column(JSONB, nullable=False, server_default=text("'[]'::jsonb"))  # [{kind, rotulo, percent, reseta}]
    usd = Column(Integer, nullable=True)                          # US$ equivalente API medido na janela
    nivel = Column(String(20), nullable=True)                     # NORMAL | ATENÇÃO | ECONOMIA | PARAR | ESGOTADA
    fonte = Column(String(120), nullable=False)                   # hostname do coletor, ou "tick.log:DeA-PC", "placar:L2820"…
    extra = Column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    criado_em = Column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)


class PainelKpi(Base):
    """Métricas de um dia numa frente, por coletor. O que um coletor não mede simplesmente não está aqui."""

    __tablename__ = "painel_kpi"
    __table_args__ = (
        UniqueConstraint("dia", "frente", "fonte", name="uq_painel_kpi_dia_frente_fonte"),
    )

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    dia = Column(Date, nullable=False, index=True)
    frente = Column(String(80), nullable=False, index=True)
    metrics = Column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    fonte = Column(String(120), nullable=False)
    criado_em = Column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)
    atualizado_em = Column(TIMESTAMP(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
