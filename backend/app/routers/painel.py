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
  GET   /decisoes?desde=                        as respostas do Diego, para quem espera por elas (poll de 30 s)
  POST  /kpi                                    {dia, frente, metrics, fonte}, lista, ou o doc kpi/diario inteiro
  GET   /kpi?dias=&frente=                      linhas fundidas por dia/frente + gates contados de painel_gates
  POST  /placar                                 {projeto, dono, estado, proximo, prazo, gate, medido_em}
  GET   /placar?dias=&projeto=                  a última linha de cada projeto + histórico
  GET   /resumo                                 números do cabeçalho

QUARTEL-GENERAL (adendo do Diego, 09/09 ~19:1xZ): quem escreve um gate não precisa de saber que isto é uma
API. O formato aceite é o mesmo JSON que a casa já escreve em ficheiro (proj, projNome, aberto, prazo,
sessao, atualizado), e coletores/gates-watch.js leva /srv/projetos/hub-deus/gates/*.json até aqui de 30 em
30 segundos. O ciclo é aberto -> respondido -> executado, e cada passo tem hora e prova.

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
from app.models_painel import PainelGate, PainelKpi, PainelPlacar, PainelTelemetria

router = APIRouter()

ESTADOS = ("aberto", "respondido", "expirado")

# código do projeto (como a Mesa e a regência escrevem) -> nome da frente (como painel-tokens.js conta o custo)
FRENTES = {
    "sb": "SuperBot", "superbot": "SuperBot",
    "lex": "LexBuild", "lexbuild": "LexBuild", "lex-build": "LexBuild",
    "ag": "Adv de Guerrilha", "adv": "Adv de Guerrilha", "eduardo": "Adv de Guerrilha",
    "donna": "Donna", "dona": "Donna",
    "mc": "Márcio", "marcio": "Márcio", "márcio": "Márcio", "licitaai": "Márcio", "hrai": "Márcio",
    "gf": "GuyFolkz", "guyfolkz": "GuyFolkz", "editorial": "GuyFolkz",
    "casa": "Cérebro", "cerebro": "Cérebro", "cérebro": "Cérebro",
    "hub": "Hub", "regencia": "Hub", "regência": "Hub",
    "hmc": "HMC", "erik": "HMC",
    "fiel": "FielIA", "fielia": "FielIA", "naka": "FielIA",
    "martin": "Martin", "mt": "Martin",
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
        "respondido_por": g.respondido_por,
        "executado_em": g.executado_em.isoformat() if g.executado_em else None,
        "executado_prova": g.executado_prova,
        "fonte_atualizado": g.fonte_atualizado.isoformat() if g.fonte_atualizado else None,
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
    """Aceita os DOIS vocabulários: o canónico e o que a casa já escreve em ficheiro (proj, projNome,
    aberto, prazo, sessao, atualizado). Quem escreve um gate não tem de aprender nomes novos."""

    model_config = {"populate_by_name": True, "extra": "ignore"}

    id: str = Field(min_length=1, max_length=64)
    projeto: str = Field(min_length=1, max_length=64, alias="proj")
    projeto_nome: Optional[str] = Field(default=None, max_length=160, alias="projNome")
    titulo: str = Field(min_length=1)
    why: Optional[str] = None
    ctx: list[Any] = Field(default_factory=list)
    opts: list[Any] = Field(default_factory=list)
    rec: Optional[str] = None
    urg: bool = False
    ts_aberto: Optional[Any] = Field(default=None, alias="aberto")
    ts_expira: Optional[Any] = Field(default=None, alias="prazo")
    fonte_atualizado: Optional[Any] = Field(default=None, alias="atualizado")
    sessao: Optional[str] = Field(default=None, max_length=120)
    origem: Optional[str] = Field(default=None, max_length=80)
    extra: dict[str, Any] = Field(default_factory=dict)


class GatePatch(BaseModel):
    escolha: Optional[str] = Field(default=None, max_length=160)
    nota: Optional[str] = None
    estado: Optional[str] = None
    ts_resposta: Optional[Any] = None
    ts_expira: Optional[Any] = None
    por: Optional[str] = Field(default=None, max_length=80)          # quem respondeu
    executado_em: Optional[Any] = None                               # o dono confirma que executou
    executado_prova: Optional[str] = None                            # e diz com que prova
    origem: Optional[str] = Field(default=None, max_length=80)


async def _upsert_gate(db: AsyncSession, body: GateIn) -> tuple[PainelGate, str]:
    g = await db.get(PainelGate, body.id)
    criado = g is None
    # idempotência do watcher: ficheiro com o mesmo (ou mais velho) "atualizado" não reescreve nada.
    # Sem isto um cron de 30 s reescrevia 150 gates por minuto, e o atualizado_em deixava de dizer algo.
    novo_carimbo = parse_ts(body.fonte_atualizado)
    if not criado and novo_carimbo and g.fonte_atualizado and novo_carimbo <= g.fonte_atualizado:
        return g, "inalterado"
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
    if body.sessao:
        g.extra = {**(g.extra or {}), "sessao": body.sessao}
    if novo_carimbo:
        g.fonte_atualizado = novo_carimbo
    if body.extra:
        g.extra = {**(g.extra or {}), **body.extra}
    await db.flush()
    # server_default/onupdate expiram criado_em/atualizado_em: sem refresh, ler o objeto dispara IO sincrono
    # dentro do asyncpg (sqlalchemy MissingGreenlet). Medido no staging em 09/09: todo PATCH dava 500.
    await db.refresh(g)
    return g, ("criado" if criado else "atualizado")


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
    g, o_que = await _upsert_gate(db, body)
    return {"criado": o_que == "criado", "resultado": o_que, "gate": gate_dict(g)}


@router.post("/gates/lote", status_code=201)
async def criar_ou_atualizar_gates(body: list[GateIn], db: AsyncSession = Depends(get_db)):
    conta = {"criado": 0, "atualizado": 0, "inalterado": 0}
    for item in body:
        _, o_que = await _upsert_gate(db, item)
        conta[o_que] += 1
    return {"criados": conta["criado"], "atualizados": conta["atualizado"],
            "inalterados": conta["inalterado"]}


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
        if body.por is not None:
            g.respondido_por = body.por
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

    # executado: quem executou a decisão confirma, com prova. É o terceiro estado do ciclo, e o que
    # permite medir "respondido -> executado" sem ninguém ir procurar a inbox.
    if body.executado_em is not None or body.executado_prova is not None:
        g.executado_em = parse_ts(body.executado_em) or ref
        if body.executado_prova is not None:
            g.executado_prova = body.executado_prova
    if body.ts_expira is not None:
        g.ts_expira = parse_ts(body.ts_expira)
    if body.origem is not None:
        g.origem = body.origem
    await db.flush()
    await db.refresh(g)
    return gate_dict(g, ref)


@router.get("/decisoes")
async def decisoes(
    desde: Optional[str] = Query(default=None, description="ISO: só respostas dadas depois deste instante"),
    projeto: Optional[str] = Query(default=None),
    limit: int = Query(default=200, ge=1, le=2000),
    db: AsyncSession = Depends(get_db),
):
    """As respostas do Diego, para quem espera por elas. A regência e o orq dono do gate fazem poll disto e
    agem. Poll e não webhook: um poll de 30 s que falha e volta é mais fiável do que um envio único, e em
    09/09 a casa perdeu um gate porque uma falha de envio foi marcada como respondida."""
    d = parse_ts(desde) if desde else None
    if desde and not d:
        raise HTTPException(status_code=400, detail="desde inválido (use ISO 8601)")
    q = select(PainelGate).where(PainelGate.ts_resposta.is_not(None))
    if d:
        q = q.where(PainelGate.ts_resposta > d)
    if projeto:
        q = q.where(PainelGate.projeto == projeto)
    q = q.order_by(PainelGate.ts_resposta.desc()).limit(limit)
    rows = list((await db.execute(q)).scalars().all())
    return {
        "gerado": agora().isoformat(),
        "desde": d.isoformat() if d else None,
        "total": len(rows),
        "decisoes": [
            {
                "id": g.id, "projeto": g.projeto, "frente": frente_de(g.projeto), "titulo": g.titulo,
                "escolha": g.escolha, "nota": g.nota,
                "respondido_em": g.ts_resposta.isoformat() if g.ts_resposta else None,
                "por": g.respondido_por,
                "executado_em": g.executado_em.isoformat() if g.executado_em else None,
                "executado_prova": g.executado_prova,
                "sessao": (g.extra or {}).get("sessao"),
                "opts": g.opts or [],
            }
            for g in rows
        ],
    }


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


async def ultimas_por_conta(db: AsyncSession, conta: Optional[str] = None) -> list[PainelTelemetria]:
    """A última leitura de cada conta que traz limites de verdade; se nenhuma trouxer, a última que houver.
    O tick do jarbas lê só o gasto (não vê os limites), e sem esta regra o cabeçalho mostrava «—»
    um minuto depois de o PC ter gravado os três números."""
    q = select(PainelTelemetria)
    if conta:
        q = q.where(PainelTelemetria.conta == conta)
    q = q.order_by(PainelTelemetria.ts.desc()).limit(600)
    rows = list((await db.execute(q)).scalars().all())
    return escolher_ultimas(rows)


def leitura_completa(t: PainelTelemetria) -> bool:
    """O tick do jarbas (--aqui) só vê as sessões do servidor e grava remotoOk=false; o do PC vê as duas
    máquinas quando o ssh funciona (remotoOk=true). Em 09/09 as duas leituras nasceram com 4 s de
    diferença e o cabeçalho mostrou US$ 991 (só jarbas) onde a completa dizia US$ 32 mil."""
    return bool(((t.extra or {}).get("leitura") or {}).get("remotoOk"))


def escolher_ultimas(rows: list[PainelTelemetria], janela_h: float = 3.0) -> list[PainelTelemetria]:
    """rows vem por ts desc. Por conta: a leitura mais recente COMPLETA e com limites, se não for mais velha
    do que janela_h em relação à mais recente de todas; senão a mais recente com limites; senão a mais recente."""
    por_conta: dict[str, list[PainelTelemetria]] = {}
    for t in rows:
        por_conta.setdefault(t.conta, []).append(t)
    out = []
    for conta, lista in por_conta.items():
        mais_nova = lista[0]
        limite = mais_nova.ts - timedelta(hours=janela_h)
        com_lim = [t for t in lista if any(v is not None for k, v in pcts(t.limites or []).items() if k != "pct_desconhecido")]
        completa = [t for t in com_lim if leitura_completa(t) and t.ts >= limite]
        out.append(completa[0] if completa else (com_lim[0] if com_lim else mais_nova))
    return sorted(out, key=lambda t: t.conta)


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

    # a última leitura de cada conta (com limites, se houver), mesmo fora da janela pedida
    ultimas = await ultimas_por_conta(db, conta)
    return {
        "gerado": ref.isoformat(),
        "desde": ini.isoformat(),
        "total": len(linhas),
        "contas": sorted({t.conta for t in linhas} | {t.conta for t in ultimas}),
        "fontes": sorted({t.fonte for t in linhas}),
        "linhas": [telemetria_dict(t) for t in linhas],
        "ultimas": [telemetria_dict(t) for t in ultimas],
    }


# ─── KPIs ─────────────────────────────────────────────────────────────────


class KpiIn(BaseModel):
    dia: date
    frente: str = Field(min_length=1, max_length=80)
    metrics: dict[str, Any] = Field(default_factory=dict)
    fonte: str = Field(min_length=1, max_length=120)


def achatar_linha_kpi(linha: dict) -> dict:
    """Uma linha do doc kpi/diario (coletores/valor-sessoes.js) vira métricas planas, para caberem numa
    tabela. `entregas.deploy_provado` -> `deploy_provado`; `gates.respondidos` -> `gates_respondidos`."""
    m: dict[str, Any] = {}
    for k, v in (linha.get("entregas") or {}).items():
        m[str(k)] = v
    for k, v in (linha.get("gates") or {}).items():
        m["gates_" + str(k)] = v
    for k in ("sessoes", "custo_usd", "custo_pct_limite", "valor_custo", "retrabalho_pct",
              "cliente_sem_resposta_min", "pontos", "pronto_declarado"):
        if linha.get(k) is not None:
            m[k] = linha[k]
    return m


def kpi_do_doc(doc: dict) -> list[KpiIn]:
    """Converte o doc kpi/diario inteiro em linhas de painel_kpi.

    ⚠️ As linhas do coletor são por frente numa JANELA, não por dia: guardá-las como se fossem de um dia
    seria inventar. O `dia` é o dia de `janela.fim` e a FONTE carrega a janela (`valor-sessoes:7d`), de
    modo que um agregado de 7 dias nunca se soma nem se sobrepõe a um de 1 dia — a chave é (dia, frente,
    fonte) — e o painel mostra a fonte ao lado de cada número."""
    janela = doc.get("janela") or {}
    fim = parse_ts(janela.get("fim")) or parse_ts(doc.get("gerado")) or agora()
    dias = int(janela.get("dias") or 1)
    fonte = f"valor-sessoes:{dias}d"
    out: list[KpiIn] = []
    for linha in doc.get("linhas") or []:
        fr = str(linha.get("frente") or "").strip()
        if not fr:
            continue
        metrics = achatar_linha_kpi(linha)
        metrics["janela_dias"] = dias
        if doc.get("gerado"):
            metrics["gerado"] = doc["gerado"]
        out.append(KpiIn(dia=fim.date(), frente=frente_de(fr)[:80], metrics=metrics, fonte=fonte))
    return out


async def _upsert_kpi(db: AsyncSession, k: KpiIn) -> None:
    stmt = pg_insert(PainelKpi).values(dia=k.dia, frente=k.frente, metrics=k.metrics, fonte=k.fonte)
    stmt = stmt.on_conflict_do_update(
        constraint="uq_painel_kpi_dia_frente_fonte",
        set_={"metrics": stmt.excluded.metrics, "atualizado_em": agora()},
    )
    await db.execute(stmt)


@router.post("/kpi", status_code=201)
async def gravar_kpi(
    body: Union[dict[str, Any], list[dict[str, Any]]] = Body(...),
    db: AsyncSession = Depends(get_db),
):
    """Três formas de corpo, todas aceites: uma linha `{dia, frente, metrics, fonte}`, uma lista dessas,
    ou o doc `kpi/diario` inteiro que `coletores/valor-sessoes.js` escreve em relatorios/kpi-sessoes.json."""
    itens: list[KpiIn] = []
    for corpo in (body if isinstance(body, list) else [body]):
        if not isinstance(corpo, dict):
            raise HTTPException(status_code=400, detail="corpo inválido")
        if "linhas" in corpo:                      # doc kpi/diario
            itens.extend(kpi_do_doc(corpo))
        else:
            try:
                itens.append(KpiIn(**corpo))
            except Exception as exc:
                raise HTTPException(status_code=400, detail=f"linha inválida: {exc}") from exc
    if not itens:
        raise HTTPException(status_code=400, detail="nenhuma linha para gravar")
    for k in itens:
        await _upsert_kpi(db, k)
    return {"gravados": len(itens), "frentes": sorted({k.frente for k in itens}),
            "fontes": sorted({k.fonte for k in itens})}


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

    # funde as fontes: uma linha por (dia, frente), com a fonte de cada métrica ao lado.
    # ⛔ Duas fontes com a MESMA chave de métrica não se sobrepõem em silêncio. Medido em 09/09 no
    # staging: a contagem do painel escreveu 5 por cima do gates_respondidos=3 que o coletor tinha
    # medido no canal do WhatsApp, e o teste só apanhou porque comparava um número conhecido. Fica a
    # primeira (a mais recente por dia/frente) e o conflito aparece na resposta, com as duas fontes.
    fundido: dict[tuple[str, str], dict] = {}
    conflitos: list[dict] = []

    def por(chave: tuple[str, str], campo: str, valor: Any, fonte: str) -> None:
        item = fundido.setdefault(chave, {"dia": chave[0], "frente": chave[1], "metrics": {}, "fontes": {}})
        if campo in item["metrics"] and item["fontes"].get(campo) != fonte and item["metrics"][campo] != valor:
            conflitos.append({"dia": chave[0], "frente": chave[1], "metrica": campo,
                              "fica": {"valor": item["metrics"][campo], "fonte": item["fontes"][campo]},
                              "ignorado": {"valor": valor, "fonte": fonte}})
            return
        item["metrics"][campo] = valor
        item["fontes"][campo] = fonte

    for k in linhas:
        chave = (k.dia.isoformat(), k.frente)
        for m, v in (k.metrics or {}).items():
            por(chave, m, v, k.fonte)

    # gates contados da própria tabela. Nomes com prefixo `painel_`: o coletor mede os gates do canal
    # do WhatsApp e da fila em disco, este conta os que vivem AQUI — são números diferentes de coisas
    # diferentes, e partilhar o nome faria um apagar o outro.
    ini_ts = datetime.combine(ini_dia, datetime.min.time(), tzinfo=timezone.utc)
    qg = select(PainelGate).where((PainelGate.ts_aberto >= ini_ts) | (PainelGate.ts_resposta >= ini_ts))
    contagem: dict[tuple[str, str], dict[str, int]] = {}
    for g in (await db.execute(qg)).scalars().all():
        fr = frente_de(g.projeto)
        if frente and fr != frente:
            continue
        for campo, ts in (("painel_gates_abertos", g.ts_aberto), ("painel_gates_respondidos", g.ts_resposta),
                          ("painel_gates_executados", g.executado_em)):
            if not ts or ts < ini_ts:
                continue
            c = contagem.setdefault((ts.date().isoformat(), fr), {})
            c[campo] = c.get(campo, 0) + 1
    for chave, campos in contagem.items():
        for campo, valor in campos.items():
            por(chave, campo, valor, "painel_gates")

    itens = sorted(fundido.values(), key=lambda x: (x["dia"], x["frente"]), reverse=True)
    metricas = sorted({m for it in itens for m in it["metrics"]})
    return {
        "gerado": ref.isoformat(),
        "desde": ini_dia.isoformat(),
        "frentes": sorted({it["frente"] for it in itens}),
        "metricas": metricas,
        "conflitos": conflitos,
        "itens": itens,
    }


# ─── Placar por projeto ───────────────────────────────────────────────────


class PlacarIn(BaseModel):
    """A linha que um orquestrador manda ao fechar ciclo. `prazo` é texto livre de propósito: quem escreve
    diz "hoje" ou "11/09" e ninguém tem de converter para o painel mostrar."""

    model_config = {"populate_by_name": True, "extra": "ignore"}

    projeto: str = Field(min_length=1, max_length=64)
    dono: Optional[str] = Field(default=None, max_length=160)
    estado: Optional[str] = None
    proximo: Optional[str] = None
    prazo: Optional[str] = Field(default=None, max_length=120)
    gate: Optional[str] = Field(default=None, max_length=200)
    medido_em: Optional[Any] = None
    fonte: Optional[str] = Field(default=None, max_length=120)
    extra: dict[str, Any] = Field(default_factory=dict)


def placar_dict(r: PainelPlacar) -> dict:
    return {
        "id": r.id, "projeto": r.projeto, "frente": frente_de(r.projeto), "dono": r.dono,
        "estado": r.estado, "proximo": r.proximo, "prazo": r.prazo, "gate": r.gate,
        "medido_em": r.medido_em.isoformat(), "fonte": r.fonte, "extra": r.extra or {},
    }


@router.post("/placar", status_code=201)
async def gravar_placar(body: Union[PlacarIn, list[PlacarIn]], db: AsyncSession = Depends(get_db)):
    itens = body if isinstance(body, list) else [body]
    gravadas = ignoradas = 0
    for it in itens:
        stmt = pg_insert(PainelPlacar).values(
            projeto=it.projeto, dono=it.dono, estado=it.estado, proximo=it.proximo, prazo=it.prazo,
            gate=it.gate, medido_em=parse_ts(it.medido_em) or agora(), fonte=it.fonte, extra=it.extra,
        ).on_conflict_do_nothing(constraint="uq_painel_placar_projeto_medido")
        r = await db.execute(stmt)
        if r.rowcount:
            gravadas += 1
        else:
            ignoradas += 1
    return {"gravadas": gravadas, "ignoradas": ignoradas}


@router.get("/placar")
async def placar(
    dias: int = Query(default=7, ge=1, le=365),
    projeto: Optional[str] = Query(default=None),
    db: AsyncSession = Depends(get_db),
):
    ref = agora()
    q = select(PainelPlacar).where(PainelPlacar.medido_em >= ref - timedelta(days=dias))
    if projeto:
        q = q.where(PainelPlacar.projeto == projeto)
    rows = list((await db.execute(q.order_by(PainelPlacar.medido_em.desc()).limit(2000))).scalars().all())
    ultimas: dict[str, PainelPlacar] = {}
    for r in rows:                                  # já vem por medido_em desc
        ultimas.setdefault(r.projeto, r)
    return {
        "gerado": ref.isoformat(),
        "atual": [placar_dict(r) for r in sorted(ultimas.values(), key=lambda r: r.projeto)],
        "historico": [placar_dict(r) for r in rows],
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
    ultimas = await ultimas_por_conta(db)
    return {
        "gerado": ref.isoformat(),
        "gates": {
            "abertos": len(abertos),
            "urgentes": sum(1 for g in abertos if g.urg),
            "respondidos": len(respondidos),
            "respondidos_hoje": sum(1 for g in respondidos if g.ts_resposta and g.ts_resposta.date() == hoje),
            "executados": sum(1 for g in gates if g.executado_em),
            "a_executar": sum(1 for g in respondidos if not g.executado_em),
            "expirados": len(expirados),
            "total": len(gates),
        },
        "contas": [telemetria_dict(t) for t in ultimas],
    }
