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


def test_frente_de_junta_codigos_da_mesa_com_nomes_do_coletor_sem_colidir():
    assert painel.frente_de("sb") == painel.frente_de("superbot") == "SuperBot"
    assert painel.frente_de("casa") == painel.frente_de("cerebro") == "Cérebro"
    assert painel.frente_de("mc") == painel.frente_de("licitaai") == "Márcio"
    # ⛔ o construtor (lex-build) e o LMS (eduardo/ag) são frentes DIFERENTES no coletor. Juntá-las faria
    # duas linhas colidirem na chave (dia, frente, fonte) e uma apagava a outra em silêncio.
    assert painel.frente_de("lex") == painel.frente_de("lex-build") == "LexBuild"
    assert painel.frente_de("ag") == painel.frente_de("eduardo") == "Adv de Guerrilha"
    assert painel.frente_de("lex-build") != painel.frente_de("eduardo")
    assert painel.frente_de("xyz") == "xyz"
    assert painel.frente_de(None) == "?"


def test_kpi_do_doc_achata_a_linha_e_poe_a_janela_na_fonte():
    doc = {
        "gerado": "2026-09-09T16:00:00Z",
        "janela": {"ini": "2026-09-02T16:00:00Z", "fim": "2026-09-09T16:00:00Z", "dias": 7},
        "linhas": [{
            "frente": "superbot", "sessoes": 9,
            "entregas": {"deploy_provado": 2, "pr_fundida": 4, "envio_cliente": 1,
                         "entrega_confirmada": 0, "relatorio_verified": 7},
            "gates": {"abertos_na_janela": 5, "respondidos": 3, "expirados": 1, "pendentes": 1,
                      "mediana_min": 152, "mesa_decisoes": 8, "mesa_executados_rastreados": 2,
                      "mesa_mediana_min": 40},
            "custo_usd": 5473, "custo_pct_limite": None, "valor_custo": 0.0021,
            "retrabalho_pct": 3.1, "cliente_sem_resposta_min": None, "pontos": 21, "pronto_declarado": 4,
        }],
    }
    linhas = painel.kpi_do_doc(doc)
    assert len(linhas) == 1
    k = linhas[0]
    assert k.dia.isoformat() == "2026-09-09" and k.frente == "SuperBot"
    # a janela vive na FONTE: um agregado de 7 dias nunca se sobrepõe a um de 1 dia (chave dia+frente+fonte)
    assert k.fonte == "valor-sessoes:7d"
    assert painel.kpi_do_doc({**doc, "janela": {**doc["janela"], "dias": 1}})[0].fonte == "valor-sessoes:1d"
    assert k.metrics["deploy_provado"] == 2 and k.metrics["gates_respondidos"] == 3
    assert k.metrics["custo_usd"] == 5473 and k.metrics["janela_dias"] == 7
    # o que o coletor mediu como "não medido" (None) não entra como zero
    assert "custo_pct_limite" not in k.metrics and "cliente_sem_resposta_min" not in k.metrics
    # pronto_declarado NÃO é entrega: entra como métrica própria, nunca somado às entregas
    assert k.metrics["pronto_declarado"] == 4


def test_gate_in_aceita_o_vocabulario_do_ficheiro_da_casa():
    g = painel.GateIn(**{
        "id": "GSB-0910-PORTA", "proj": "sb", "projNome": "SuperBot (Emílio)", "titulo": "t",
        "aberto": "2026-09-10T08:12:00Z", "prazo": "2026-09-10T20:00:00Z",
        "atualizado": "2026-09-10T08:12:00Z", "sessao": "local_9e455d31",
        "opts": [["A", "abrir já", "o cliente vê [imagem]"]], "urg": True,
        "campo_que_nao_existe": "ignorado sem erro",
    })
    assert g.projeto == "sb" and g.projeto_nome == "SuperBot (Emílio)" and g.sessao == "local_9e455d31"
    assert painel.parse_ts(g.ts_aberto).hour == 8 and painel.parse_ts(g.ts_expira).hour == 20
    assert painel.parse_ts(g.fonte_atualizado) is not None
    # e o canónico continua a valer
    g2 = painel.GateIn(id="X", projeto="casa", titulo="t")
    assert g2.projeto == "casa"


def tele(**kw):
    base = dict(id=1, ts=AGORA, conta="Diego", limites=[], usd=0, nivel=None, fonte="x", extra={})
    base.update(kw)
    return SimpleNamespace(**base)


def test_ultima_leitura_prefere_a_completa_recente_e_nao_a_parcial_do_jarbas():
    lim = [{"kind": "weekly_all", "rotulo": "geral", "percent": 5}]
    parcial = tele(id=3, ts=AGORA, usd=991, limites=lim, fonte="vmi2571201", extra={"leitura": {"remotoOk": False}})
    completa = tele(id=2, ts=AGORA - timedelta(seconds=4), usd=32350, limites=lim, fonte="DeA-PC", extra={"leitura": {"remotoOk": True}})
    so_usd = tele(id=4, ts=AGORA + timedelta(minutes=5), usd=1000, limites=[], fonte="tick.log:jarbas")
    eduardo = tele(id=5, ts=AGORA - timedelta(hours=1), conta="Eduardo", limites=lim, usd=2, extra={})
    esc = painel.escolher_ultimas([so_usd, parcial, completa, eduardo])
    assert [(t.conta, t.id) for t in esc] == [("Diego", 2), ("Eduardo", 5)]
    # completa velha demais (5 h) perde para a parcial recente com limites
    velha = tele(id=6, ts=AGORA - timedelta(hours=5), usd=30000, limites=lim, extra={"leitura": {"remotoOk": True}})
    esc = painel.escolher_ultimas([parcial, velha])
    assert esc[0].id == 3


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
