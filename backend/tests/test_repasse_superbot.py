"""Repasse da instância Evolution ao SuperBot: só a instância e os eventos certos, com a apikey no cabeçalho."""

import pytest

from app.config import settings
from app.routers import webhook


@pytest.fixture
def ligado(monkeypatch):
    monkeypatch.setattr(settings, "SUPERBOT_EVOLUTION_WEBHOOK_URL", "https://superbot.exemplo/api/webhook/evolution")
    monkeypatch.setattr(settings, "SUPERBOT_EVOLUTION_INSTANCIA", "guyfolkz")


def _payload(**kw):
    p = {"event": "messages.upsert", "instance": "guyfolkz", "apikey": "chave-da-instancia", "data": {}}
    p.update(kw)
    return p


def test_repassa_mensagem_da_instancia_com_apikey_no_cabecalho(ligado):
    assert webhook._superbot_forward_target(_payload()) == (
        "https://superbot.exemplo/api/webhook/evolution", {"apikey": "chave-da-instancia"})


def test_repassa_ack(ligado):
    assert webhook._superbot_forward_target(_payload(event="messages.update")) is not None


@pytest.mark.parametrize("mudanca", [
    {"instance": "diego pessoal"},
    {"event": "send.message"},
    {"event": "chats.upsert"},
    {"apikey": ""},
])
def test_nao_repassa_fora_do_escopo(ligado, mudanca):
    assert webhook._superbot_forward_target(_payload(**mudanca)) is None


def test_desligado_sem_url(monkeypatch):
    monkeypatch.setattr(settings, "SUPERBOT_EVOLUTION_WEBHOOK_URL", "")
    assert webhook._superbot_forward_target(_payload()) is None


@pytest.mark.anyio
async def test_post_leva_o_cabecalho(ligado, monkeypatch):
    chamadas = []

    class Cliente:
        def __init__(self, *a, **k): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def post(self, url, json=None, headers=None):
            chamadas.append((url, headers))
            class R: status_code = 200
            return R()

    import httpx
    monkeypatch.setattr(httpx, "AsyncClient", Cliente)
    await webhook._forward_to_superbot(_payload())
    await webhook._forward_to_superbot(_payload(instance="outra"))
    assert chamadas == [("https://superbot.exemplo/api/webhook/evolution", {"apikey": "chave-da-instancia"})]


# ── Nova tentativa (18/11/2026) ───────────────────────────────────────────────
# Sem o conserto, um 502 do SuperBot perdia o evento: havia uma tentativa só.

import httpx


def _cliente_roteirizado(monkeypatch, roteiro):
    """Troca o httpx.AsyncClient por um que devolve, em ordem, os status ou exceções do roteiro."""
    chamadas = []

    class Cliente:
        def __init__(self, *a, **k): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def post(self, url, json=None, headers=None):
            chamadas.append(json["event"])
            passo = roteiro[len(chamadas) - 1]
            if isinstance(passo, Exception):
                raise passo
            class R: status_code = passo
            return R()

    esperas = []

    async def dormir(s):
        esperas.append(s)

    monkeypatch.setattr(httpx, "AsyncClient", Cliente)
    # raising=False: o código antigo não tem _dormir, e o teste deve falhar pela contagem, não por AttributeError.
    monkeypatch.setattr(webhook, "_dormir", dormir, raising=False)
    return chamadas, esperas


@pytest.mark.anyio
async def test_502_na_troca_de_deploy_repete_e_entrega(ligado, monkeypatch):
    chamadas, esperas = _cliente_roteirizado(monkeypatch, [502, 502, 200])
    await webhook._forward_to_superbot(_payload())
    assert len(chamadas) == 3
    assert esperas == list(webhook.SUPERBOT_ESPERAS_S)
    assert sum(esperas) <= 35


@pytest.mark.anyio
async def test_falha_de_conexao_repete(ligado, monkeypatch):
    chamadas, _ = _cliente_roteirizado(monkeypatch, [httpx.ConnectError("recusada"), 200])
    await webhook._forward_to_superbot(_payload())
    assert len(chamadas) == 2


@pytest.mark.anyio
async def test_para_em_3_tentativas_e_registra_a_perda(ligado, monkeypatch, caplog):
    chamadas, _ = _cliente_roteirizado(monkeypatch, [502, 502, 502, 200])
    with caplog.at_level("ERROR"):
        await webhook._forward_to_superbot(_payload(data={"key": {"id": "ABC123"}}))
    assert len(chamadas) == 3
    assert "PERDIDO" in caplog.text and "ABC123" in caplog.text


@pytest.mark.anyio
async def test_200_na_primeira_nao_repete(ligado, monkeypatch):
    chamadas, esperas = _cliente_roteirizado(monkeypatch, [200])
    await webhook._forward_to_superbot(_payload())
    assert chamadas == ["messages.upsert"] and esperas == []


@pytest.mark.anyio
async def test_4xx_nao_repete(ligado, monkeypatch):
    chamadas, _ = _cliente_roteirizado(monkeypatch, [401, 200])
    await webhook._forward_to_superbot(_payload())
    assert len(chamadas) == 1


# O SuperBot não descarta mensagem repetida pela chave: repetir o que pode ter sido
# processado duplicaria a mensagem do contato. Timeout de leitura e 500 numa mensagem
# (messages.upsert) não se repetem; no ack (messages.update, só UPDATE) se repetem.

@pytest.mark.anyio
@pytest.mark.parametrize("falha", [httpx.ReadTimeout("lento"), 500, 504])
async def test_mensagem_possivelmente_processada_nao_repete(ligado, monkeypatch, falha):
    chamadas, _ = _cliente_roteirizado(monkeypatch, [falha, 200])
    await webhook._forward_to_superbot(_payload())
    assert len(chamadas) == 1


@pytest.mark.anyio
@pytest.mark.parametrize("falha", [httpx.ReadTimeout("lento"), 500, 504, 502])
async def test_ack_repete_em_qualquer_5xx_e_timeout(ligado, monkeypatch, falha):
    chamadas, _ = _cliente_roteirizado(monkeypatch, [falha, 200])
    await webhook._forward_to_superbot(_payload(event="messages.update"))
    assert len(chamadas) == 2
