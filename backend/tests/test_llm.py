"""
Tests for app.services.llm — the chat-completion funnel used by 16 call sites.

Written when the OpenRouter key died in production (2026-09-17, 401 "User not
found") and Diego decided to keep Groq as the provider:

  - LLM_PROVIDER selects Groq or OpenRouter; Groq is the default.
  - OpenRouter model names still set in the production env (claude-sonnet,
    gpt-4o-mini, grok) are mapped onto the Groq catalogue instead of 404ing.
  - Groq free tier is 8k tokens/min: a 1h call (~14k tokens) cannot be
    summarised in one request, so long transcriptions go map-reduce, 429s
    honour Retry-After and 413 (request too large) is not retried.
"""

import json

import httpx
import pytest

from app.services import llm


def _ok(content: str, usage: int = 100) -> httpx.Response:
    return httpx.Response(
        200,
        json={"choices": [{"message": {"content": content}}], "usage": {"total_tokens": usage}},
    )


@pytest.fixture
def llm_http(monkeypatch):
    """MockTransport around httpx.AsyncClient inside the llm module; records requests."""

    class Rec:
        def __init__(self):
            self.calls: list[httpx.Request] = []
            self.responder = lambda request: _ok("resposta")

        def handler(self, request):
            self.calls.append(request)
            return self.responder(request)

        def payloads(self) -> list[dict]:
            return [json.loads(c.content) for c in self.calls]

    rec = Rec()
    real = httpx.AsyncClient

    def factory(**kw):
        kw.pop("transport", None)
        return real(transport=httpx.MockTransport(rec.handler), **kw)

    monkeypatch.setattr(llm.httpx, "AsyncClient", factory)
    return rec


@pytest.fixture
def groq(monkeypatch):
    monkeypatch.setattr(llm.settings, "LLM_PROVIDER", "groq")
    monkeypatch.setattr(llm.settings, "GROQ_API_KEY", "gsk_test")
    monkeypatch.setattr(llm.settings, "OPENROUTER_API_KEY", "")
    # what production still has in its env
    monkeypatch.setattr(llm.settings, "MODEL_CHAT_SMART", "anthropic/claude-sonnet-4-20250514")
    monkeypatch.setattr(llm.settings, "MODEL_CHAT_CHEAP", "openai/gpt-4o-mini")


@pytest.fixture
def no_sleep(monkeypatch):
    waits: list[float] = []

    async def fake_sleep(seconds):
        waits.append(seconds)

    monkeypatch.setattr(llm.asyncio, "sleep", fake_sleep)
    return waits


# ---------------------------------------------------------------------------
# provider routing and model mapping
# ---------------------------------------------------------------------------


def test_is_configured_follows_the_selected_provider(monkeypatch):
    monkeypatch.setattr(llm.settings, "LLM_PROVIDER", "groq")
    monkeypatch.setattr(llm.settings, "GROQ_API_KEY", "")
    monkeypatch.setattr(llm.settings, "OPENROUTER_API_KEY", "sk-or")
    assert llm.is_configured() is False

    monkeypatch.setattr(llm.settings, "GROQ_API_KEY", "gsk")
    assert llm.is_configured() is True

    monkeypatch.setattr(llm.settings, "LLM_PROVIDER", "openrouter")
    monkeypatch.setattr(llm.settings, "OPENROUTER_API_KEY", "")
    assert llm.is_configured() is False


@pytest.mark.anyio
async def test_groq_routes_to_groq_and_maps_openrouter_model_names(groq, llm_http):
    await llm.chat_completion([{"role": "user", "content": "oi"}])  # default = MODEL_CHAT_SMART
    await llm.chat_completion([{"role": "user", "content": "oi"}], model="openai/gpt-4o-mini")
    await llm.chat_completion([{"role": "user", "content": "oi"}], model="x-ai/grok-4.1-fast")
    await llm.chat_completion([{"role": "user", "content": "oi"}], model="qwen/qwen3.8-27b")

    assert all(str(c.url).startswith("https://api.groq.com/openai/v1/chat/completions") for c in llm_http.calls)
    assert all(c.headers["Authorization"] == "Bearer gsk_test" for c in llm_http.calls)
    models = [p["model"] for p in llm_http.payloads()]
    assert models == [
        "openai/gpt-oss-120b",  # claude-sonnet (smart) -> smart
        "openai/gpt-oss-20b",   # MODEL_CHAT_CHEAP -> cheap
        "openai/gpt-oss-120b",  # unknown OpenRouter name -> smart
        "qwen/qwen3.8-27b",     # already a Groq model: untouched
    ]


@pytest.mark.anyio
async def test_openrouter_provider_keeps_model_names(monkeypatch, llm_http):
    monkeypatch.setattr(llm.settings, "LLM_PROVIDER", "openrouter")
    monkeypatch.setattr(llm.settings, "OPENROUTER_API_KEY", "sk-or-test")
    monkeypatch.setattr(llm.settings, "GROQ_API_KEY", "gsk_test")

    await llm.chat_completion([{"role": "user", "content": "oi"}], model="anthropic/claude-sonnet-4-20250514")

    assert str(llm_http.calls[0].url) == "https://openrouter.ai/api/v1/chat/completions"
    assert llm_http.calls[0].headers["Authorization"] == "Bearer sk-or-test"
    assert llm_http.payloads()[0]["model"] == "anthropic/claude-sonnet-4-20250514"
    assert "reasoning_effort" not in llm_http.payloads()[0]


@pytest.mark.anyio
async def test_gpt_oss_gets_low_reasoning_and_json_mode_sets_response_format(groq, llm_http):
    await llm.chat_completion([{"role": "user", "content": "JSON por favor"}], json_mode=True)

    payload = llm_http.payloads()[0]
    assert payload["reasoning_effort"] == "low"
    assert payload["response_format"] == {"type": "json_object"}


# ---------------------------------------------------------------------------
# rate limits
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_429_waits_retry_after_then_succeeds(groq, llm_http, no_sleep):
    state = {"n": 0}

    def responder(request):
        state["n"] += 1
        if state["n"] == 1:
            return httpx.Response(429, headers={"retry-after": "7"}, json={"error": "rate limit"})
        return _ok("depois do limite")

    llm_http.responder = responder

    assert await llm.chat_completion([{"role": "user", "content": "oi"}]) == "depois do limite"
    assert len(llm_http.calls) == 2
    assert no_sleep == [7.0]


@pytest.mark.anyio
async def test_413_request_too_large_is_not_retried(groq, llm_http, no_sleep):
    llm_http.responder = lambda request: httpx.Response(413, json={"error": {"message": "Request too large"}})

    with pytest.raises(httpx.HTTPStatusError):
        await llm.chat_completion([{"role": "user", "content": "x" * 100_000}])

    assert len(llm_http.calls) == 1
    assert no_sleep == []


# ---------------------------------------------------------------------------
# meeting summary: single call vs map-reduce
# ---------------------------------------------------------------------------

SUMMARY_JSON = json.dumps({
    "title": "Call teste", "summary": "resumo", "action_items": [{"task": "t", "assignee": None, "priority": "low"}],
    "decisions": [], "key_topics": ["x"], "detected_project": "Projeto Superbot",
})


@pytest.mark.anyio
async def test_short_transcription_is_one_json_call(groq, llm_http, monkeypatch):
    monkeypatch.setattr(llm.settings, "LLM_MAX_INPUT_TOKENS", 6000)
    llm_http.responder = lambda request: _ok(SUMMARY_JSON)

    result = await llm.generate_meeting_summary("fala curta. " * 50, known_projects=["Projeto Superbot"])

    assert result["title"] == "Call teste"
    assert result["detected_project"] == "Projeto Superbot"
    assert len(llm_http.calls) == 1
    assert llm_http.payloads()[0]["response_format"] == {"type": "json_object"}
    assert "Projeto Superbot" in llm_http.payloads()[0]["messages"][0]["content"]


@pytest.mark.anyio
async def test_long_transcription_goes_map_reduce_within_budget(groq, llm_http, monkeypatch):
    """~14k tokens (today's 1h call) with a 6k budget -> N map calls + 1 reduce, every request under budget."""
    monkeypatch.setattr(llm.settings, "LLM_MAX_INPUT_TOKENS", 6000)
    transcription = ("Diego falou sobre a campanha da Dentaly e o Emílio respondeu sobre a Terrana. " * 600)  # ~47k chars

    def responder(request):
        payload = json.loads(request.content)
        if payload.get("response_format"):
            return _ok(SUMMARY_JSON)  # reduce step
        return _ok("- nota parcial do trecho")  # map step

    llm_http.responder = responder

    result = await llm.generate_meeting_summary(transcription)

    payloads = llm_http.payloads()
    map_calls = [p for p in payloads if not p.get("response_format")]
    reduce_calls = [p for p in payloads if p.get("response_format")]
    assert len(map_calls) >= 2, "a 47k-char transcription must be split"
    assert len(reduce_calls) == 1
    budget_chars = 6000 * llm.CHARS_PER_TOKEN
    for p in payloads:
        assert len(p["messages"][-1]["content"]) <= budget_chars * 1.05, "every request must stay under the token budget"
    # the whole transcription was covered, in order
    joined = "".join(p["messages"][-1]["content"] for p in map_calls)
    assert transcription.strip()[:60] in joined and transcription.strip()[-60:] in joined
    assert result["title"] == "Call teste"


def test_split_text_keeps_order_and_covers_everything():
    text = "Primeira frase. Segunda frase! Terceira frase? " * 40
    parts = llm._split_text(text, max_chars=300)

    assert all(len(p) <= 300 for p in parts)
    assert "".join(parts).replace(" ", "") == text.replace(" ", "")
