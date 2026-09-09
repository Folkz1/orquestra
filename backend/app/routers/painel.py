"""
Painel de Regência — gates do Diego, telemetria das contas Claude (série) e KPIs por frente/dia.

Briefing: docs/briefings/painel-regencia.md. Todas as rotas vivem sob /api/painel e passam pelo
Bearer do middleware (APP_SECRET_KEY): nada aqui é público.

  GET   /gates?estado=&projeto=&desde=&limit=   abertos primeiro (urgentes no topo), depois histórico
  POST  /gates                                  upsert por id; nunca toca na resposta de um gate respondido
  POST  /gates/lote                             o mesmo, em lista (importação)
  GET   /gates/{id}
  PATCH /gates/{id}                             responder {escolha, nota} · expirar {estado} · reabrir
  POST  /telemetria                             corpo = JSON do telemetria-tick --paraMesa (ou lista); 1 linha por conta
  GET   /serie?conta=&dias=&fonte=              a série + a última leitura por conta
  POST  /kpi                                    {dia, frente, metrics, fonte} ou lista; upsert
  GET   /kpi?dias=&frente=                      linhas fundidas por dia/frente + gates contados de painel_gates
  GET   /resumo                                 números do cabeçalho

O modelo não entra em lado nenhum: tudo o que sai daqui é contado a partir de dado com fonte e hora.
"""

from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional, Union

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models_painel import PainelGate, PainelKpi, PainelTelemetria

router = APIRouter()

ESTADOS = ("aberto", "respondido", "expirado")

# código do projeto (como a Mesa e a regência escrevem) -> nome da frente (como painel-tokens.js conta o custo)
FRENTES = {
    "sb": "SuperBot", "superbot": "SuperBot",
    "lex": "LexBuild", "lexbuild": "LexBuild", "ag": "LexBuild", "adv": "LexBuild",
    "donna": "Donna", "dona": "Donna",
    "mc": "Márcio", "marcio": "Márcio", "márcio": "Márcio", "licitaai": "Márcio", "hrai": "Márcio",
    "gf": "GuyFolkz", "guyfolkz": "GuyFolkz", "editorial": "GuyFolkz",
    "casa": "Cérebro", "cerebro": "Cérebro", "cérebro": "Cérebro",
    "hub": "Hub", "regencia": "Hub", "regência": "Hub",
    "hmc": "HMC", "erik": "HMC",
    "fiel": "FielIA", "fielia": "FielIA", "naka": "FielIA",
}


def frente_de(projeto: Optional[str]) -> str:
    p = (projeto or "").strip()
    return FRENTES.get(p.lower(), p or "?")


def agora() -> datetime:
    return datetime.now(timezone.utc)


def parse_ts(v: Any) -> Optional[datetime]:
    """Aceita ISO com ou sem segundos, com 'Z' ou offset, ou epoch em ms. Nulo se não der."""
    if v is None or v == "":
        return None
    if isinstance(v, datetime):
        return v if v.tzinfo else v.replace(tzinfo=timezone.utc)
    if isinstance(v, (int, float)):
        return datetime.fromtimestamp(v / 1000 if v > 1e11 else v, tz=timezone.utc)
    s = str(v).strip()
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    try:
        d = datetime.fromisoformat(s)
    except ValueError:
        return None
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def estado_efetivo(g: PainelGate, ref: Optional[datetime] = None) -> str:
    """Aberto com prazo no passado conta como expirado, sem ninguém ter de escrever isso."""
    ref = ref or agora()
    if g.estado == "aberto" and g.ts_expira and g.ts_expira < ref:
        return "expirado"
    return g.estado


def gate_dict(g: PainelGate, ref: Optional[datetime] = None) -> dict:
    return {
        "id": g.id,
        "projeto": g.projeto,
        "projeto_nome": g.projeto_nome,
        "frente": frente_de(g.projeto),
        "titulo": g.titulo,
        "why": g.why,
        "ctx": g.ctx or [],
        "opts": g.opts or [],
        "rec": g.rec,
        "urg": bool(g.urg),
        "estado": estado_efetivo(g, ref),
        "escolha": g.escolha,
        "nota": g.nota,
        "ts_aberto": g.ts_aberto.isoformat() if g.ts_aberto else None,
        "ts_resposta": g.ts_resposta.isoformat() if g.ts_resposta else None,
        "ts_expira": g.ts_expira.isoformat() if g.ts_expira else None,
        "origem": g.origem,
        "extra": g.extra or {},
        "criado_em": g.criado_em.isoformat() if g.criado_em else None,
        "atualizado_em": g.atualizado_em.isoformat() if g.atualizado_em else None,
    }


def ordenar_gates(gates: list[PainelGate], ref: Optional[datetime] = None) -> list[PainelGate]:
    """Abertos primeiro (urgentes no topo, mais recentes primeiro); depois respondidos e expirados
    do mais recente ao mais antigo. Quem não tem hora de abertura fica depois de quem tem."""
    ref = ref or agora()
    zero = datetime(1970, 1, 1, tzinfo=timezone.utc)

    def chave(g: PainelGate):
        est = estado_efetivo(g, ref)
        abertura = g.ts_aberto or g.criado_em or zero
        if est == "aberto":
            return (0, 0 if g.urg else 1, -abertura.timestamp())
        fecho = g.ts_resposta or g.atualizado_em or abertura
        return (1, 0 if est == "respondido" else 1, -fecho.timestamp())

    return sorted(gates, key=chave)


# ─── Gates ────────────────────────────────────────────────────────────────


class GateIn(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    projeto: str = Field(min_length=1, max_length=64)
    projeto_nome: Optional[str] = Field(default=None, max_length=160)
    titulo: str = Field(min_length=1)
    why: Optional[str] = None
    ctx: list[Any] = Field(default_factory=list)
    opts: list[Any] = Field(default_factory=list)
    rec: Optional[str] = None
    urg: bool = False
    ts_aberto: Optional[Any] = None
    ts_expira: Optional[Any] = None
    origem: Optional[str] = Field(default=None, max_length=80)
    extra: dict[str, Any] = Field(default_factory=dict)


class GatePatch(BaseModel):
    escolha: Optional[str] = Field(default=None, max_length=160)
    nota: Optional[str] = None
    estado: Optional[str] = None
    ts_resposta: Optional[Any] = None
    ts_expira: Optional[Any] = None
    origem: Optional[str] = Field(default=None, max_length=80)


async def _upsert_gate(db: AsyncSession, body: GateIn) -> tuple[PainelGate, bool]:
    g = await db.get(PainelGate, body.id)
    criado = g is None
    if criado:
        g = PainelGate(id=body.id, projeto=body.projeto, titulo=body.titulo, ctx=[], opts=[], extra={})
        db.add(g)
    # o texto do gate pode ser reescrito por quem o abriu (a regência atualiza contexto ao longo do dia);
    # a RESPOSTA nunca é tocada por aqui — só o PATCH mexe em escolha/nota/estado.
    g.projeto = body.projeto
    if body.projeto_nome is not None:
        g.projeto_nome = body.projeto_nome
    g.titulo = body.titulo
    g.why = body.why
    g.ctx = list(body.ctx or [])
    g.opts = list(body.opts or [])
    g.rec = body.rec
    g.urg = bool(body.urg)
    if body.ts_aberto is not None:
        g.ts_aberto = parse_ts(body.ts_aberto)
    if body.ts_expira is not None:
        g.ts_expira = parse_ts(body.ts_expira)
    if body.origem is not None:
        g.origem = body.origem
    if body.extra:
        g.extra = {**(g.extra or {}), **body.extra}
    await db.flush()
    return g, criado


@router.get("/gates")
async def listar_gates(
    estado: Optional[str] = Query(default=None, description="aberto | respondido | expirado"),
    projeto: Optional[str] = Query(default=None),
    desde: Optional[str] = Query(default=None, description="ISO: só gates respondidos/atualizados a partir daqui"),
    limit: int = Query(default=500, ge=1, le=2000),
    db: AsyncSession = Depends(get_db),
):
    if estado and estado not in ESTADOS:
        raise HTTPException(status_code=400, detail=f"estado inválido: {estado}")
    q = select(PainelGate)
    if projeto:
        q = q.where(PainelGate.projeto == projeto)
    d = parse_ts(desde) if desde else None
    if desde and not d:
        raise HTTPException(status_code=400, detail="desde inválido (use ISO 8601)")
    if d:
        q = q.where((PainelGate.ts_resposta >= d) | (PainelGate.atualizado_em >= d))
    rows = list((await db.execute(q)).scalars().all())
    ref = agora()
    if estado:
        rows = [g for g in rows if estado_efetivo(g, ref) == estado]
    rows = ordenar_gates(rows, ref)[:limit]
    projetos: dict[str, Optional[str]] = {}
    for g in rows:
        if g.projeto not in projetos or (not projetos[g.projeto] and g.projeto_nome):
            projetos[g.projeto] = g.projeto_nome
    return {
        "gerado": ref.isoformat(),
        "total": len(rows),
        "projetos": [{"id": k, "nome": v or k, "frente": frente_de(k)} for k, v in sorted(projetos.items())],
        "gates": [gate_dict(g, ref) for g in rows],
    }


@router.post("/gates", status_code=201)
async def criar_ou_atualizar_gate(body: GateIn, db: AsyncSession = Depends(get_db)):
    g, criado = await _upsert_gate(db, body)
    return {"criado": criado, "gate": gate_dict(g)}


@router.post("/gates/lote", status_code=201)
async def criar_ou_atualizar_gates(body: list[GateIn], db: AsyncSession = Depends(get_db)):
    criados = atualizados = 0
    for item in body:
        _, criado = await _upsert_gate(db, item)
        if criado:
            criados += 1
        else:
            atualizados += 1
    return {"criados": criados, "atualizados": atualizados}


@router.get("/gates/{gate_id}")
async def obter_gate(gate_id: str, db: AsyncSession = Depends(get_db)):
    g = await db.get(PainelGate, gate_id)
    if not g:
        raise HTTPException(status_code=404, detail="gate não encontrado")
    return gate_dict(g)


@router.patch("/gates/{gate_id}")
async def responder_gate(gate_id: str, body: GatePatch, db: AsyncSession = Depends(get_db)):
    g = await db.get(PainelGate, gate_id)
    if not g:
        raise HTTPException(status_code=404, detail="gate não encontrado")
    if body.estado and body.estado not in ESTADOS:
        raise HTTPException(status_code=400, detail=f"estado inválido: {body.estado}")

    ref = agora()
    responder = body.escolha is not None or body.estado == "respondido"
    if responder:
        if not (body.escolha or g.escolha):
            raise HTTPException(status_code=400, detail="responder exige escolha")
        # resposta anterior não se perde: vai para o histórico
        if g.estado == "respondido" and (g.escolha or g.nota):
            hist = list((g.extra or {}).get("historico", []))
            hist.append({"escolha": g.escolha, "nota": g.nota,
                         "ts_resposta": g.ts_resposta.isoformat() if g.ts_resposta else None})
            g.extra = {**(g.extra or {}), "historico": hist}
        if body.escolha is not None:
            g.escolha = body.escolha
        if body.nota is not None:
            g.nota = body.nota
        g.estado = "respondido"
        g.ts_resposta = parse_ts(body.ts_resposta) or ref
    elif body.estado == "expirado":
        g.estado = "expirado"
        if body.nota is not None:
            g.nota = body.nota
    elif body.estado == "aberto":
        g.estado = "aberto"
        if body.nota is not None:
            g.nota = body.nota
    elif body.nota is not None:
        g.nota = body.nota          # só a nota, sem mudar o estado

    if body.ts_expira is not None:
        g.ts_expira = parse_ts(body.ts_expira)
    if body.origem is not None:
        g.origem = body.origem
    await db.flush()
    return gate_dict(g, ref)


# ─── Telemetria (série) ───────────────────────────────────────────────────

_CAMPOS_CONTA_EXTRA = ("respostas", "sessoes", "ativas", "estimado", "pico", "regra", "teto", "lidoMs", "manual", "fonte")
_CAMPOS_LEITURA_EXTRA = ("remotoOk", "sessoesJarbas", "origens", "janela", "regua", "total", "gerado", "colhidoEm")


def pcts(limites: list) -> dict:
    """Tira da lista de limites os três números que o painel desenha. Kind 'desconhecido' (log do
    tick, que não diz de que limite era a %) fica à parte, nunca como semana."""
    out: dict[str, Optional[float]] = {"pct_semana": None, "pct_fable": None, "pct_sessao": None, "pct_desconhecido": None}
    for l in limites or []:
        if not isinstance(l, dict) or l.get("percent") is None:
            continue
        k = str(l.get("kind") or "").lower()
        r = str(l.get("rotulo") or "").lower()
        p = l.get("percent")
        if k == "desconhecido":
            out["pct_desconhecido"] = p
        elif k == "session" or "sess" in r:
            out["pct_sessao"] = p
        elif "fable" in r or k == "weekly_scoped":
            out["pct_fable"] = p
        elif k in ("weekly_all", "weekly") or "geral" in r or "semana" in r:
            out["pct_semana"] = p
    return out


def telemetria_dict(t: PainelTelemetria) -> dict:
    return {
        "id": t.id,
        "ts": t.ts.isoformat(),
        "conta": t.conta,
        "limites": t.limites or [],
        **pcts(t.limites or []),
        "usd": t.usd,
        "nivel": t.nivel,
        "fonte": t.fonte,
        "extra": t.extra or {},
    }


async def _gravar_leitura(db: AsyncSession, leitura: dict, fonte_padrao: str) -> tuple[int, int]:
    contas = leitura.get("contas") or []
    if not isinstance(contas, list) or not contas:
        raise HTTPException(status_code=400, detail="leitura sem contas")
    ts = parse_ts(leitura.get("ts") or leitura.get("colhidoEm") or leitura.get("gerado"))
    if not ts:
        raise HTTPException(status_code=400, detail="leitura sem ts/colhidoEm/gerado válido")
    fonte = str(leitura.get("fonte") or leitura.get("origem") or fonte_padrao)[:120]
    extra_leitura = {k: leitura[k] for k in _CAMPOS_LEITURA_EXTRA if k in leitura}
    gravadas = ignoradas = 0
    for c in contas:
        if not isinstance(c, dict):
            continue
        # o nome chega já sem e-mail (o --paraMesa apaga-o); se vier e-mail, fica só a parte antes do @
        nome = c.get("nome") or str(c.get("conta") or "").split("@")[0]
        if not nome:
            continue
        usd = c.get("usd")
        try:
            usd = int(round(float(usd))) if usd is not None else None
        except (TypeError, ValueError):
            usd = None
        extra = {k: c[k] for k in _CAMPOS_CONTA_EXTRA if k in c}
        if extra_leitura:
            extra["leitura"] = extra_leitura
        stmt = pg_insert(PainelTelemetria).values(
            ts=ts, conta=str(nome)[:40], limites=list(c.get("limites") or []), usd=usd,
            nivel=(str(c.get("nivel"))[:20] if c.get("nivel") else None), fonte=fonte, extra=extra,
        ).on_conflict_do_nothing(constraint="uq_painel_telemetria_ts_conta_fonte")
        r = await db.execute(stmt)
        if r.rowcount:
            gravadas += 1
        else:
            ignoradas += 1
    return gravadas, ignoradas


@router.post("/telemetria", status_code=201)
async def gravar_telemetria(
    body: Union[dict[str, Any], list[dict[str, Any]]] = Body(...),
    db: AsyncSession = Depends(get_db),
):
    leituras = body if isinstance(body, list) else [body]
    if not leituras:
        raise HTTPException(status_code=400, detail="corpo vazio")
    gravadas = ignoradas = 0
    for leitura in leituras:
        g, i = await _gravar_leitura(db, leitura, "api")
        gravadas += g
        ignoradas += i
    return {"gravadas": gravadas, "ignoradas": ignoradas}


@router.get("/serie")
async def serie(
    conta: Optional[str] = Query(default=None),
    dias: int = Query(default=7, ge=1, le=365),
    fonte: Optional[str] = Query(default=None),
    limit: int = Query(default=5000, ge=1, le=20000),
    db: AsyncSession = Depends(get_db),
):
    ref = agora()
    ini = ref - timedelta(days=dias)
    q = select(PainelTelemetria).where(PainelTelemetria.ts >= ini)
    if conta:
        q = q.where(PainelTelemetria.conta == conta)
    if fonte:
        q = q.where(PainelTelemetria.fonte == fonte)
    q = q.order_by(PainelTelemetria.ts.asc()).limit(limit)
    linhas = list((await db.execute(q)).scalars().all())

    # a última leitura de cada conta, seja de que fonte for, mesmo fora da janela pedida
    ultimas: dict[str, PainelTelemetria] = {}
    qu = select(PainelTelemetria).order_by(PainelTelemetria.ts.desc()).limit(400)
    if conta:
        qu = qu.where(PainelTelemetria.conta == conta)
    for t in (await db.execute(qu)).scalars().all():
        if t.conta not in ultimas:
            ultimas[t.conta] = t
    return {
        "gerado": ref.isoformat(),
        "desde": ini.isoformat(),
        "total": len(linhas),
        "contas": sorted({t.conta for t in linhas} | set(ultimas.keys())),
        "fontes": sorted({t.fonte for t in linhas}),
        "linhas": [telemetria_dict(t) for t in linhas],
        "ultimas": [telemetria_dict(t) for t in sorted(ultimas.values(), key=lambda t: t.conta)],
    }


# ─── KPIs ─────────────────────────────────────────────────────────────────


class KpiIn(BaseModel):
    dia: date
    frente: str = Field(min_length=1, max_length=80)
    metrics: dict[str, Any] = Field(default_factory=dict)
    fonte: str = Field(min_length=1, max_length=120)


async def _upsert_kpi(db: AsyncSession, k: KpiIn) -> None:
    stmt = pg_insert(PainelKpi).values(dia=k.dia, frente=k.frente, metrics=k.metrics, fonte=k.fonte)
    stmt = stmt.on_conflict_do_update(
        constraint="uq_painel_kpi_dia_frente_fonte",
        set_={"metrics": stmt.excluded.metrics, "atualizado_em": agora()},
    )
    await db.execute(stmt)


@router.post("/kpi", status_code=201)
async def gravar_kpi(body: Union[KpiIn, list[KpiIn]], db: AsyncSession = Depends(get_db)):
    itens = body if isinstance(body, list) else [body]
    for k in itens:
        await _upsert_kpi(db, k)
    return {"gravados": len(itens)}


@router.get("/kpi")
async def kpis(
    dias: int = Query(default=14, ge=1, le=365),
    frente: Optional[str] = Query(default=None),
    db: AsyncSession = Depends(get_db),
):
    ref = agora()
    ini_dia = (ref - timedelta(days=dias)).date()
    q = select(PainelKpi).where(PainelKpi.dia >= ini_dia)
    if frente:
        q = q.where(PainelKpi.frente == frente)
    q = q.order_by(PainelKpi.dia.desc(), PainelKpi.frente.asc())
    linhas = list((await db.execute(q)).scalars().all())

    # funde as fontes: uma linha por (dia, frente), com a fonte de cada métrica ao lado
    fundido: dict[tuple[str, str], dict] = {}
    for k in linhas:
        chave = (k.dia.isoformat(), k.frente)
        item = fundido.setdefault(chave, {"dia": chave[0], "frente": k.frente, "metrics": {}, "fontes": {}})
        for m, v in (k.metrics or {}).items():
            item["metrics"][m] = v
            item["fontes"][m] = k.fonte

    # gates contados da própria tabela: abertos por dia de abertura, respondidos por dia de resposta
    ini_ts = datetime.combine(ini_dia, datetime.min.time(), tzinfo=timezone.utc)
    qg = select(PainelGate).where((PainelGate.ts_aberto >= ini_ts) | (PainelGate.ts_resposta >= ini_ts))
    for g in (await db.execute(qg)).scalars().all():
        fr = frente_de(g.projeto)
        if frente and fr != frente:
            continue
        for campo, ts in (("gates_abertos", g.ts_aberto), ("gates_respondidos", g.ts_resposta)):
            if not ts or ts < ini_ts:
                continue
            chave = (ts.date().isoformat(), fr)
            item = fundido.setdefault(chave, {"dia": chave[0], "frente": fr, "metrics": {}, "fontes": {}})
            item["metrics"][campo] = int(item["metrics"].get(campo) or 0) + 1
            item["fontes"][campo] = "painel_gates"

    itens = sorted(fundido.values(), key=lambda x: (x["dia"], x["frente"]), reverse=True)
    metricas = sorted({m for it in itens for m in it["metrics"]})
    return {
        "gerado": ref.isoformat(),
        "desde": ini_dia.isoformat(),
        "frentes": sorted({it["frente"] for it in itens}),
        "metricas": metricas,
        "itens": itens,
    }


# ─── Resumo ───────────────────────────────────────────────────────────────


@router.get("/resumo")
async def resumo(db: AsyncSession = Depends(get_db)):
    ref = agora()
    hoje = ref.date()
    gates = list((await db.execute(select(PainelGate))).scalars().all())
    abertos = [g for g in gates if estado_efetivo(g, ref) == "aberto"]
    expirados = [g for g in gates if estado_efetivo(g, ref) == "expirado"]
    respondidos = [g for g in gates if estado_efetivo(g, ref) == "respondido"]
    ultimas: dict[str, PainelTelemetria] = {}
    for t in (await db.execute(select(PainelTelemetria).order_by(PainelTelemetria.ts.desc()).limit(400))).scalars().all():
        if t.conta not in ultimas:
            ultimas[t.conta] = t
    return {
        "gerado": ref.isoformat(),
        "gates": {
            "abertos": len(abertos),
            "urgentes": sum(1 for g in abertos if g.urg),
            "respondidos": len(respondidos),
            "respondidos_hoje": sum(1 for g in respondidos if g.ts_resposta and g.ts_resposta.date() == hoje),
            "expirados": len(expirados),
            "total": len(gates),
        },
        "contas": [telemetria_dict(t) for t in sorted(ultimas.values(), key=lambda t: t.conta)],
    }
