"""
Testes do Painel de Regência.

Unitários (sem banco): a lógica pura do router — ordenação dos gates, estado efetivo, extração das
percentagens e o parser de datas.

Integração (opcional): com PAINEL_API_URL e PAINEL_API_TOKEN no ambiente, percorre o contrato contra um
backend vivo (staging): cria um gate de teste, responde-o, grava uma leitura de telemetria duas vezes
(a segunda tem de ser ignorada), grava um KPI e lê a série e o resumo. Sem as variáveis, é saltado.

⛔ Só contra STAGING. O teste deixa rasto (gates GTEST-*, conta "TesteContrato", fonte "teste-contrato"):
não há DELETE na API de propósito, e em produção isso apareceria no painel do Diego. Limpar no staging:
  DELETE FROM painel_gates WHERE id LIKE 'GTEST-%'; DELETE FROM painel_telemetria WHERE fonte='teste-contrato';
  DELETE FROM painel_kpi WHERE fonte='teste';

  cd backend && python -m pytest tests/test_painel.py -q
  PAINEL_API_URL=https://... PAINEL_API_TOKEN=... python -m pytest tests/test_painel.py -q -m integracao
"""

import os
import sys
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.routers import painel  # noqa: E402

AGORA = datetime(2026, 9, 9, 16, 0, tzinfo=timezone.utc)


def gate(**kw):
    base = dict(id="G1", projeto="sb", projeto_nome=None, titulo="t", why=None, ctx=[], opts=[], rec=None,
                urg=False, estado="aberto", escolha=None, nota=None, ts_aberto=None, ts_resposta=None,
                ts_expira=None, origem=None, extra={}, criado_em=AGORA, atualizado_em=AGORA)
    base.update(kw)
    return SimpleNamespace(**base)


# ─── unitários ────────────────────────────────────────────────────────────


def test_parse_ts_aceita_os_formatos_que_os_coletores_produzem():
    assert painel.parse_ts("2026-09-09T15:40Z") == datetime(2026, 9, 9, 15, 40, tzinfo=timezone.utc)
    assert painel.parse_ts("2026-09-09T15:40:52.427Z").second == 52
    assert painel.parse_ts("2026-09-08T18:07:05.196+00:00").minute == 7
    assert painel.parse_ts(1788966620218).year == 2026          # epoch em ms
    assert painel.parse_ts(None) is None
    assert painel.parse_ts("ontem às cinco") is None


def test_estado_efetivo_expira_pelo_prazo_sem_ninguem_escrever():
    g = gate(ts_expira=AGORA - timedelta(hours=1))
    assert painel.estado_efetivo(g, AGORA) == "expirado"
    g2 = gate(ts_expira=AGORA + timedelta(hours=1))
    assert painel.estado_efetivo(g2, AGORA) == "aberto"
    g3 = gate(estado="respondido", ts_expira=AGORA - timedelta(hours=1))
    assert painel.estado_efetivo(g3, AGORA) == "respondido"      # respondido não expira


def test_ordenacao_abertos_urgentes_primeiro_depois_historico():
    velho = gate(id="velho", ts_aberto=AGORA - timedelta(days=2))
    novo = gate(id="novo", ts_aberto=AGORA - timedelta(hours=1))
    urgente = gate(id="urg", urg=True, ts_aberto=AGORA - timedelta(days=5))
    sem_hora = gate(id="semhora", ts_aberto=None, criado_em=AGORA - timedelta(days=9))
    respondido = gate(id="resp", estado="respondido", ts_resposta=AGORA - timedelta(minutes=5))
    expirado = gate(id="exp", ts_expira=AGORA - timedelta(hours=1), ts_aberto=AGORA - timedelta(hours=6))
    ordem = [g.id for g in painel.ordenar_gates([respondido, velho, expirado, sem_hora, novo, urgente], AGORA)]
    assert ordem[:4] == ["urg", "novo", "velho", "semhora"]
    assert ordem[4:] == ["resp", "exp"]


def test_pcts_separa_semana_fable_sessao_e_nao_promove_desconhecido():
    p = painel.pcts([
        {"kind": "session", "rotulo": "sessão 5h", "percent": 26},
        {"kind": "weekly_all", "rotulo": "geral", "percent": 5},
        {"kind": "weekly_scoped", "rotulo": "Fable", "percent": 4},
    ])
    assert (p["pct_sessao"], p["pct_semana"], p["pct_fable"]) == (26, 5, 4)
    q = painel.pcts([{"kind": "weekly", "rotulo": "semana Fable", "percent": 90}, {"kind": "weekly", "rotulo": "semana", "percent": 100}])
    assert (q["pct_fable"], q["pct_semana"]) == (90, 100)
    r = painel.pcts([{"kind": "desconhecido", "rotulo": "primeiro limite impresso no log", "percent": 70}])
    assert r["pct_semana"] is None and r["pct_desconhecido"] == 70


def test_frente_de_junta_codigos_da_mesa_com_nomes_do_painel_tokens():
    assert painel.frente_de("sb") == "SuperBot"
    assert painel.frente_de("ag") == "LexBuild"
    assert painel.frente_de("casa") == "Cérebro"
    assert painel.frente_de("xyz") == "xyz"
    assert painel.frente_de(None) == "?"


# ─── integração (staging vivo) ────────────────────────────────────────────

URL = os.environ.get("PAINEL_API_URL", "").rstrip("/")
TOKEN = os.environ.get("PAINEL_API_TOKEN", "")
integracao = pytest.mark.skipif(not (URL and TOKEN), reason="PAINEL_API_URL/PAINEL_API_TOKEN ausentes")


def _cli():
    import httpx
    return httpx.Client(base_url=URL, headers={"Authorization": f"Bearer {TOKEN}"}, timeout=30)


@integracao
def test_contrato_completo_contra_backend_vivo():
    c = _cli()
    gid = "GTEST-" + uuid.uuid4().hex[:6].upper()
    ts = datetime.now(timezone.utc).replace(microsecond=0)

    # sem token: recusado
    import httpx
    assert httpx.get(URL + "/api/painel/resumo", timeout=30).status_code == 403

    # cria o gate
    r = c.post("/api/painel/gates", json={
        "id": gid, "projeto": "casa", "projeto_nome": "Casa (teste)", "titulo": "gate de teste do contrato",
        "why": "teste", "ctx": ["p1"], "opts": [["A", "sim", "faz"], ["B", "não", "não faz"]], "rec": "A",
        "urg": True, "ts_aberto": ts.isoformat(), "origem": "teste",
    })
    assert r.status_code == 201 and r.json()["criado"] is True
    # aparece aberto, urgente, no topo
    lista = c.get("/api/painel/gates", params={"estado": "aberto"}).json()
    assert lista["gates"][0]["id"] == gid
    # reescrever o texto não toca na resposta
    r = c.post("/api/painel/gates", json={"id": gid, "projeto": "casa", "titulo": "título revisto"})
    assert r.json()["criado"] is False and r.json()["gate"]["estado"] == "aberto"
    # responder
    r = c.patch(f"/api/painel/gates/{gid}", json={"escolha": "A", "nota": "vai"})
    assert r.status_code == 200 and r.json()["estado"] == "respondido" and r.json()["ts_resposta"]
    # o upsert depois da resposta continua a não mexer nela
    r = c.post("/api/painel/gates", json={"id": gid, "projeto": "casa", "titulo": "outra revisão"})
    g = r.json()["gate"]
    assert g["estado"] == "respondido" and g["escolha"] == "A" and g["titulo"] == "outra revisão"
    # responder de novo guarda a anterior no histórico
    r = c.patch(f"/api/painel/gates/{gid}", json={"escolha": "B", "nota": "mudei"})
    assert r.json()["escolha"] == "B" and r.json()["extra"]["historico"][0]["escolha"] == "A"
    # responder sem escolha é recusado
    assert c.patch(f"/api/painel/gates/{gid}", json={"estado": "respondido"}).status_code == 200  # já tem escolha B
    gid2 = gid + "-B"
    c.post("/api/painel/gates", json={"id": gid2, "projeto": "casa", "titulo": "sem escolha"})
    assert c.patch(f"/api/painel/gates/{gid2}", json={"estado": "respondido"}).status_code == 400
    # expirar
    assert c.patch(f"/api/painel/gates/{gid2}", json={"estado": "expirado"}).json()["estado"] == "expirado"

    # telemetria: a mesma leitura duas vezes grava uma
    leitura = {"colhidoEm": ts.isoformat(), "fonte": "teste-contrato",
               "contas": [{"nome": "TesteContrato", "usd": 1, "nivel": "NORMAL",
                           "limites": [{"kind": "weekly_all", "rotulo": "geral", "percent": 7}]},
                          {"nome": "TesteContrato2", "usd": 2, "limites": []}]}
    r1 = c.post("/api/painel/telemetria", json=leitura).json()
    r2 = c.post("/api/painel/telemetria", json=leitura).json()
    assert r1 == {"gravadas": 2, "ignoradas": 0} and r2 == {"gravadas": 0, "ignoradas": 2}
    serie = c.get("/api/painel/serie", params={"dias": 1, "fonte": "teste-contrato"}).json()
    assert any(l["conta"] == "TesteContrato" and l["pct_semana"] == 7 for l in serie["linhas"])
    assert c.post("/api/painel/telemetria", json={"contas": []}).status_code == 400

    # kpi: upsert substitui as métricas da mesma chave
    dia = ts.date().isoformat()
    c.post("/api/painel/kpi", json={"dia": dia, "frente": "TesteContrato", "metrics": {"custo_usd": 1}, "fonte": "teste"})
    c.post("/api/painel/kpi", json=[{"dia": dia, "frente": "TesteContrato", "metrics": {"custo_usd": 3, "respostas": 9}, "fonte": "teste"}])
    k = c.get("/api/painel/kpi", params={"dias": 2, "frente": "TesteContrato"}).json()
    item = next(i for i in k["itens"] if i["dia"] == dia)
    assert item["metrics"]["custo_usd"] == 3 and item["fontes"]["respostas"] == "teste"

    # resumo responde e conta o gate respondido de hoje
    res = c.get("/api/painel/resumo").json()
    assert res["gates"]["respondidos_hoje"] >= 1 and "contas" in res
