"""
Embeddings must stay in the text-embedding-3-small space: the memory table holds
23k vectors (Vector(1536)) in it, and Groq has no embedding model. With the
OpenRouter key dead, OpenAI direct is the drop-in — same model, same space.
"""

import json

import httpx
import pytest

from app.services import memory


@pytest.fixture
def emb_http(monkeypatch):
    calls: list[httpx.Request] = []
    real = httpx.AsyncClient

    def handler(request):
        calls.append(request)
        return httpx.Response(200, json={"data": [{"embedding": [0.1] * 1536}]})

    def factory(**kw):
        kw.pop("transport", None)
        return real(transport=httpx.MockTransport(handler), **kw)

    monkeypatch.setattr(memory.httpx, "AsyncClient", factory)
    return calls


@pytest.mark.anyio
async def test_openai_key_takes_precedence_and_uses_same_model(monkeypatch, emb_http):
    monkeypatch.setattr(memory.settings, "OPENAI_API_KEY", "sk-openai")
    monkeypatch.setattr(memory.settings, "OPENROUTER_API_KEY", "sk-or")

    vec = await memory.generate_embedding("texto")

    assert len(vec) == 1536
    assert str(emb_http[0].url) == "https://api.openai.com/v1/embeddings"
    assert emb_http[0].headers["Authorization"] == "Bearer sk-openai"
    assert json.loads(emb_http[0].content)["model"] == "text-embedding-3-small"


@pytest.mark.anyio
async def test_falls_back_to_openrouter_when_no_openai_key(monkeypatch, emb_http):
    monkeypatch.setattr(memory.settings, "OPENAI_API_KEY", "")
    monkeypatch.setattr(memory.settings, "OPENROUTER_API_KEY", "sk-or")

    await memory.generate_embedding("texto")

    assert str(emb_http[0].url) == "https://openrouter.ai/api/v1/embeddings"
    assert json.loads(emb_http[0].content)["model"] == "openai/text-embedding-3-small"


@pytest.mark.anyio
async def test_no_key_skips_without_calling_anyone(monkeypatch, emb_http):
    monkeypatch.setattr(memory.settings, "OPENAI_API_KEY", "")
    monkeypatch.setattr(memory.settings, "OPENROUTER_API_KEY", "")

    assert await memory.generate_embedding("texto") == []
    assert emb_http == []
