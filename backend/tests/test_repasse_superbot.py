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
