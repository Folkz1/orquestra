"""
Orquestra - LLM Service
Chat completions via OpenRouter with retry logic.
Meeting/recording summary generation.
"""

import asyncio
import json
import logging
import re

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

MAX_RETRIES = 3
INITIAL_BACKOFF = 1.0  # seconds


async def chat_completion(
    messages: list[dict],
    model: str | None = None,
    temperature: float = 0.3,
    max_tokens: int = 4000,
) -> str:
    """
    Send a chat completion request to OpenRouter with exponential backoff retry.

    Args:
        messages: List of message dicts (role/content).
        model: Model identifier (defaults to MODEL_CHAT_SMART).
        temperature: Sampling temperature.
        max_tokens: Maximum tokens in response.

    Returns:
        The assistant's response content string.

    Raises:
        httpx.HTTPStatusError: After all retries exhausted.
    """
    if not model:
        model = settings.MODEL_CHAT_SMART

    url = f"{settings.OPENROUTER_BASE_URL}/chat/completions"
    headers = {
        "Authorization": f"Bearer {settings.OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }

    last_exc = None
    for attempt in range(MAX_RETRIES):
        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                response = await client.post(url, headers=headers, json=payload)
                response.raise_for_status()

            data = response.json()
            content = data["choices"][0]["message"]["content"].strip()
            logger.info(
                "[LLM] model=%s tokens=%s attempt=%d",
                model,
                data.get("usage", {}).get("total_tokens", "?"),
                attempt + 1,
            )
            return content

        except (httpx.HTTPStatusError, httpx.ConnectError, httpx.ReadTimeout) as exc:
            last_exc = exc
            body = ""
            if isinstance(exc, httpx.HTTPStatusError):
                try:
                    body = exc.response.text[:500]
                except Exception:
                    pass
            if attempt < MAX_RETRIES - 1:
                wait = INITIAL_BACKOFF * (2 ** attempt)
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


async def generate_meeting_summary(transcription: str, known_projects: list[str] | None = None) -> dict:
    """
    Generate a structured summary of a meeting/recording transcription.

    Args:
        transcription: Full text transcription of the recording.
        known_projects: Optional list of known project names for auto-detection.

    Returns:
        Dict with keys: title, summary, action_items, decisions, key_topics, detected_project
    """
    project_hint = ""
    if known_projects:
        project_hint = (
            f"\n\nProjetos conhecidos do Diego: {', '.join(known_projects)}. "
            "Se a gravacao mencionar algum desses projetos, inclua o campo "
            '"detected_project" com o nome EXATO do projeto mais relevante. '
            "Se nenhum projeto for mencionado, use null."
        )

    messages = [
        {
            "role": "system",
            "content": (
                "Voce e um assistente de produtividade do Diego, um desenvolvedor brasileiro. "
                "Analise a transcricao de uma reuniao/gravacao e retorne um JSON com a seguinte estrutura:\n"
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
                "}\n\n"
                "Responda APENAS com o JSON, sem texto adicional."
                + project_hint
            ),
        },
        {
            "role": "user",
            "content": f"Transcricao:\n\n{transcription}",
        },
    ]

    response_text = await chat_completion(
        messages, model=settings.MODEL_CHAT_SMART, temperature=0.2, max_tokens=4000
    )

    result = _parse_json_response(response_text)
    logger.info("[LLM] Generated meeting summary: %s", result.get("title", "?"))
    return result
