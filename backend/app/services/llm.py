"""
Orquestra - LLM Service
Chat completions via Groq (default) or OpenRouter, with retry logic.
Meeting/recording summary generation (map-reduce for long transcriptions).
"""

import asyncio
import json
import logging
import re

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

MAX_RETRIES = 5  # Groq free tier answers 429 often; Retry-After is honoured
INITIAL_BACKOFF = 1.0  # seconds
MAX_RETRY_AFTER = 65.0  # never sleep longer than this on a 429

# Portuguese prose on these tokenizers runs ~3 chars/token; 3.0 keeps us safe.
CHARS_PER_TOKEN = 3

# Model ids that exist on Groq. Anything else configured in MODEL_* (OpenRouter
# names such as anthropic/claude-*, openai/gpt-4o-mini, x-ai/grok-*) is mapped
# onto GROQ_MODEL_SMART / GROQ_MODEL_CHEAP so the production env needs no edit.
GROQ_MODEL_PREFIXES = ("openai/gpt-oss", "qwen/", "groq/", "meta-llama/", "moonshotai/", "allam-")


def _provider() -> str:
    return (settings.LLM_PROVIDER or "groq").lower()


def is_configured() -> bool:
    """True when the selected chat provider has an API key."""
    if _provider() == "groq":
        return bool(settings.GROQ_API_KEY)
    return bool(settings.OPENROUTER_API_KEY)


def _endpoint() -> tuple[str, str]:
    """(chat completions url, api key) for the selected provider."""
    if _provider() == "groq":
        return f"{settings.GROQ_BASE_URL}/chat/completions", settings.GROQ_API_KEY
    return f"{settings.OPENROUTER_BASE_URL}/chat/completions", settings.OPENROUTER_API_KEY


def resolve_model(model: str | None) -> str:
    """Model id to send: as configured on OpenRouter, mapped onto the catalogue on Groq."""
    model = model or settings.MODEL_CHAT_SMART
    if _provider() != "groq":
        return model
    if model.startswith(GROQ_MODEL_PREFIXES):
        return model
    if model == settings.MODEL_CHAT_CHEAP:
        return settings.GROQ_MODEL_CHEAP
    return settings.GROQ_MODEL_SMART


def _retry_after_seconds(response: httpx.Response) -> float | None:
    value = response.headers.get("retry-after")
    if not value:
        return None
    try:
        return min(float(value), MAX_RETRY_AFTER)
    except ValueError:
        return None


async def chat_completion(
    messages: list[dict],
    model: str | None = None,
    temperature: float = 0.3,
    max_tokens: int = 4000,
    json_mode: bool = False,
) -> str:
    """
    Send a chat completion request to the configured provider with retry.

    Args:
        messages: List of message dicts (role/content).
        model: Model identifier (defaults to MODEL_CHAT_SMART; mapped on Groq).
        temperature: Sampling temperature.
        max_tokens: Maximum tokens in response.
        json_mode: Ask the provider for a JSON object response.

    Returns:
        The assistant's response content string.

    Raises:
        httpx.HTTPStatusError: After all retries exhausted, or at once on
        403 (key limit) and 413 (request too large — retrying cannot help).
    """
    model = resolve_model(model)
    url, api_key = _endpoint()
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload: dict = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    if json_mode:
        payload["response_format"] = {"type": "json_object"}
    if model.startswith("openai/gpt-oss"):
        # Reasoning tokens count against the per-minute budget; "low" is plenty
        # for summaries/drafts and keeps content from being starved by thinking.
        payload["reasoning_effort"] = "low"

    last_exc = None
    for attempt in range(MAX_RETRIES):
        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                response = await client.post(url, headers=headers, json=payload)
                response.raise_for_status()

            data = response.json()
            content = (data["choices"][0]["message"].get("content") or "").strip()
            logger.info(
                "[LLM] provider=%s model=%s tokens=%s attempt=%d",
                _provider(),
                model,
                data.get("usage", {}).get("total_tokens", "?"),
                attempt + 1,
            )
            return content

        except (httpx.HTTPStatusError, httpx.ConnectError, httpx.ReadTimeout) as exc:
            last_exc = exc
            body = ""
            wait = INITIAL_BACKOFF * (2 ** attempt)
            if isinstance(exc, httpx.HTTPStatusError):
                try:
                    body = exc.response.text[:500]
                except Exception:
                    pass
                status = exc.response.status_code
                if status == 403:
                    logger.error("[LLM] 403 (key limit exceeded). body=%s", body)
                    raise
                if status == 413:
                    logger.error("[LLM] 413 request too large for %s (%d chars). body=%s",
                                 model, sum(len(m.get("content", "")) for m in messages), body)
                    raise
                if status == 429:
                    wait = _retry_after_seconds(exc.response) or wait
            if attempt < MAX_RETRIES - 1:
                logger.warning(
                    "[LLM] Attempt %d failed (%s) body=%s, retrying in %.1fs...",
                    attempt + 1,
                    str(exc)[:120],
                    body,
                    wait,
                )
                await asyncio.sleep(wait)
            else:
                logger.error("[LLM] All %d attempts failed. Last body: %s", MAX_RETRIES, body)

    raise last_exc  # type: ignore[misc]


def _parse_json_response(text: str) -> dict:
    """
    Extract JSON from an LLM response that may contain markdown code fences.
    """
    # Try to find JSON in code blocks first
    match = re.search(r"```(?:json)?\s*\n?(.*?)\n?```", text, re.DOTALL)
    if match:
        return json.loads(match.group(1).strip())

    # Try parsing the raw text as JSON
    # Find the first { and last }
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1:
        return json.loads(text[start : end + 1])

    raise ValueError(f"Could not parse JSON from LLM response: {text[:200]}...")


def _split_text(text: str, max_chars: int) -> list[str]:
    """Split on sentence boundaries into pieces of at most max_chars, in order."""
    sentences = re.split(r"(?<=[.!?])\s+", text.strip())
    parts: list[str] = []
    current = ""
    for sentence in sentences:
        while len(sentence) > max_chars:  # pathological run without punctuation
            if current:
                parts.append(current)
                current = ""
            parts.append(sentence[:max_chars])
            sentence = sentence[max_chars:]
        candidate = f"{current} {sentence}".strip() if current else sentence
        if len(candidate) > max_chars and current:
            parts.append(current)
            current = sentence
        else:
            current = candidate
    if current:
        parts.append(current)
    return parts


_SUMMARY_SCHEMA = (
    "{\n"
    '  "title": "Titulo curto e descritivo da reuniao",\n'
    '  "summary": "Resumo executivo em 2-3 paragrafos",\n'
    '  "action_items": [\n'
    '    {"task": "descricao", "assignee": "pessoa ou null", "priority": "high|medium|low"}\n'
    "  ],\n"
    '  "decisions": [\n'
    '    {"decision": "descricao", "context": "contexto breve"}\n'
    "  ],\n"
    '  "key_topics": ["topico1", "topico2"],\n'
    '  "detected_project": "nome do projeto ou null"\n'
    "}"
)

_SUMMARY_RULES = (
    "\n\nRegras:\n"
    "- action_items: no maximo 12, somente o que foi explicitamente combinado na conversa, "
    "ordenado por importancia. assignee e o NOME da pessoa que assumiu (ex.: Diego, Emilio) "
    "ou null — nunca invente equipes ou cargos.\n"
    "- decisions: somente decisoes de fato tomadas, nao ideias discutidas.\n"
    "- title: curto, com os participantes e os 2-3 temas principais.\n"
    "- Nao invente nomes, valores, datas ou lugares que nao estejam no material."
)


MAX_ACTION_ITEMS = 12
MAX_DECISIONS = 10
_PRIORITIES = {"high", "medium", "low"}


def _as_text(value) -> str | None:
    """Coerce a field the model may return as list/dict/number into a plain string (or None)."""
    if value is None:
        return None
    if isinstance(value, str):
        return value.strip() or None
    if isinstance(value, (list, tuple)):
        parts = [t for t in (_as_text(v) for v in value) if t]
        return ", ".join(parts) or None
    return str(value)


def _normalize_summary(raw: dict) -> dict:
    """
    Enforce the summary schema in code: the models drift (assignee as a list,
    20 action items when asked for 12, priority "alta"), and the DB/frontend
    expect exact types. Never trust the prompt alone for structure.
    """
    items = []
    for item in raw.get("action_items") or []:
        if not isinstance(item, dict):
            task = _as_text(item)
            item = {"task": task}
        task = _as_text(item.get("task"))
        if not task:
            continue
        priority = _as_text(item.get("priority")) or "medium"
        priority = priority.lower()
        if priority not in _PRIORITIES:
            priority = "medium"
        items.append({"task": task, "assignee": _as_text(item.get("assignee")), "priority": priority})

    decisions = []
    for dec in raw.get("decisions") or []:
        if not isinstance(dec, dict):
            dec = {"decision": _as_text(dec)}
        decision = _as_text(dec.get("decision"))
        if decision:
            decisions.append({"decision": decision, "context": _as_text(dec.get("context")) or ""})

    topics = raw.get("key_topics") or []
    if isinstance(topics, str):
        topics = [topics]
    topics = [t for t in (_as_text(t) for t in topics) if t][:12]

    return {
        "title": _as_text(raw.get("title")) or "",
        "summary": _as_text(raw.get("summary")) or "",
        "action_items": items[:MAX_ACTION_ITEMS],
        "decisions": decisions[:MAX_DECISIONS],
        "key_topics": topics,
        "detected_project": _as_text(raw.get("detected_project")),
    }


def _project_hint(known_projects: list[str] | None) -> str:
    if not known_projects:
        return ""
    return (
        f"\n\nProjetos conhecidos do Diego: {', '.join(known_projects)}. "
        "Se a gravacao mencionar algum desses projetos, inclua o campo "
        '"detected_project" com o nome EXATO do projeto mais relevante. '
        "Se nenhum projeto for mencionado, use null."
    )


async def _summary_json(user_content: str, known_projects: list[str] | None) -> dict:
    messages = [
        {
            "role": "system",
            "content": (
                "Voce e um assistente de produtividade do Diego, um desenvolvedor brasileiro. "
                "Analise o material de uma reuniao/gravacao e retorne um JSON com a seguinte estrutura:\n"
                + _SUMMARY_SCHEMA
                + "\n\nResponda APENAS com o JSON, sem texto adicional."
                + _project_hint(known_projects)
            ),
        },
        {"role": "user", "content": user_content},
    ]
    response_text = await chat_completion(
        messages, model=settings.MODEL_CHAT_SMART, temperature=0.2, max_tokens=4000, json_mode=True
    )
    return _normalize_summary(_parse_json_response(response_text))


async def _summarize_chunk(chunk: str, index: int, total: int, known_projects: list[str] | None = None) -> str:
    messages = [
        {
            "role": "system",
            "content": (
                "Voce e um assistente de produtividade do Diego, um desenvolvedor brasileiro. "
                f"Este e o trecho {index + 1} de {total} da transcricao de uma reuniao. "
                "Escreva notas detalhadas em portugues, em topicos: assuntos tratados, decisoes tomadas, "
                "tarefas explicitamente combinadas (com o nome de quem assumiu, so se foi dito), "
                "numeros, datas, lugares e nomes citados. Separe o que foi DECIDIDO do que foi apenas "
                "ideia ou conversa solta. Nao invente nada que nao esteja no trecho."
                + (f" Projetos conhecidos do Diego: {', '.join(known_projects)} — "
                   "se algum aparecer, cite o nome exato." if known_projects else "")
            ),
        },
        {"role": "user", "content": chunk},
    ]
    return await chat_completion(
        messages, model=settings.MODEL_CHAT_SMART, temperature=0.2, max_tokens=1500
    )


async def generate_meeting_summary(transcription: str, known_projects: list[str] | None = None) -> dict:
    """
    Generate a structured summary of a meeting/recording transcription.

    Transcriptions that fit LLM_MAX_INPUT_TOKENS go in one JSON call. Longer ones
    are summarised map-reduce style: detailed notes per chunk, then one JSON call
    over the notes — that is what keeps a 1h call inside Groq's free-tier budget.

    Args:
        transcription: Full text transcription of the recording.
        known_projects: Optional list of known project names for auto-detection.

    Returns:
        Dict with keys: title, summary, action_items, decisions, key_topics, detected_project
    """
    budget_chars = settings.LLM_MAX_INPUT_TOKENS * CHARS_PER_TOKEN

    if len(transcription) <= budget_chars:
        result = await _summary_json(f"Transcricao:\n\n{transcription}", known_projects)
        logger.info("[LLM] Generated meeting summary: %s", result.get("title", "?"))
        return result

    chunks = _split_text(transcription, budget_chars)
    logger.info(
        "[LLM] Transcription of %d chars exceeds budget (%d chars): map-reduce over %d chunks",
        len(transcription), budget_chars, len(chunks),
    )
    notes = []
    for i, chunk in enumerate(chunks):
        notes.append(await _summarize_chunk(chunk, i, len(chunks), known_projects))

    joined = "\n\n".join(f"[Trecho {i + 1}/{len(chunks)}]\n{n}" for i, n in enumerate(notes))
    if len(joined) > budget_chars:
        # Notes themselves overflowed (very long call): trim proportionally, keeping the order.
        joined = joined[:budget_chars]
    result = await _summary_json(
        f"Notas por trecho da transcricao completa ({len(chunks)} trechos, em ordem):\n\n{joined}",
        known_projects,
    )
    logger.info("[LLM] Generated meeting summary (map-reduce): %s", result.get("title", "?"))
    return result
