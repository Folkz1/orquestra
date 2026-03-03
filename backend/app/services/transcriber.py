"""
Orquestra - Transcription & Vision Service
Audio transcription via Groq Whisper, image description via OpenRouter.
"""

import base64
import logging

import httpx

from app.config import settings

logger = logging.getLogger(__name__)


async def transcribe_audio(file_path: str) -> str:
    """
    Transcribe an audio file using Groq Whisper API (preferred) or raise error.

    Args:
        file_path: Path to the audio file on disk.

    Returns:
        Transcription text.

    Raises:
        RuntimeError: If no transcription API key is configured.
        httpx.HTTPStatusError: If the API returns an error.
    """
    if not settings.GROQ_API_KEY:
        raise RuntimeError(
            "GROQ_API_KEY not configured. Audio transcription requires Groq Whisper."
        )

    url = "https://api.groq.com/openai/v1/audio/transcriptions"
    headers = {"Authorization": f"Bearer {settings.GROQ_API_KEY}"}

    # Read the file and determine a sensible filename for the API
    filename = file_path.rsplit("/", 1)[-1] if "/" in file_path else file_path.rsplit("\\", 1)[-1]

    async with httpx.AsyncClient(timeout=120.0) as client:
        with open(file_path, "rb") as audio_file:
            files = {
                "file": (filename, audio_file, "audio/ogg"),
                "model": (None, "whisper-large-v3"),
                "language": (None, "pt"),
            }
            response = await client.post(url, headers=headers, files=files)
            response.raise_for_status()

    data = response.json()
    text = data.get("text", "").strip()
    logger.info("[TRANSCRIBER] Transcribed %s -> %d chars", filename, len(text))
    return text


async def describe_image(image_bytes: bytes, mimetype: str = "image/jpeg") -> str:
    """
    Describe an image using OpenRouter vision model.

    Args:
        image_bytes: Raw image bytes.
        mimetype: MIME type of the image (default: image/jpeg).

    Returns:
        Description text in Portuguese.

    Raises:
        httpx.HTTPStatusError: If the API returns an error.
    """
    b64_image = base64.b64encode(image_bytes).decode("utf-8")
    data_url = f"data:{mimetype};base64,{b64_image}"

    url = f"{settings.OPENROUTER_BASE_URL}/chat/completions"
    headers = {
        "Authorization": f"Bearer {settings.OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": settings.MODEL_VISION,
        "messages": [
            {
                "role": "system",
                "content": (
                    "Descreva detalhadamente esta imagem em portugues. "
                    "Se houver texto, transcreva."
                ),
            },
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {"url": data_url},
                    }
                ],
            },
        ],
        "max_tokens": 2000,
        "temperature": 0.2,
    }

    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.post(url, headers=headers, json=payload)
        response.raise_for_status()

    data = response.json()
    description = data["choices"][0]["message"]["content"].strip()
    logger.info("[TRANSCRIBER] Described image -> %d chars", len(description))
    return description
