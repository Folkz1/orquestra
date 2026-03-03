"""
Orquestra - Media Service
Download media from Evolution API and save to disk.
"""

import base64
import logging
import os

import aiofiles
import httpx

from app.config import settings

logger = logging.getLogger(__name__)


async def download_media_from_evolution(message_id: str) -> bytes:
    """
    Download media from Evolution API using getBase64 endpoint.

    Args:
        message_id: The Evolution message ID to fetch media for.

    Returns:
        Raw bytes of the media file.

    Raises:
        httpx.HTTPStatusError: If the API returns an error status.
        ValueError: If the response does not contain valid base64 data.
    """
    url = (
        f"{settings.EVOLUTION_API_URL}/message/getBase64/"
        f"{settings.EVOLUTION_INSTANCE}/{message_id}"
    )
    headers = {"apikey": settings.EVOLUTION_API_KEY}

    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.get(url, headers=headers)
        response.raise_for_status()

    data = response.json()

    # Evolution API returns {"base64": "..."} or the base64 string directly
    b64_string = data if isinstance(data, str) else data.get("base64", "")
    if not b64_string:
        raise ValueError(f"No base64 data in Evolution response for message {message_id}")

    # Strip data URI prefix if present (e.g. "data:audio/ogg;base64,...")
    if "," in b64_string:
        b64_string = b64_string.split(",", 1)[1]

    return base64.b64decode(b64_string)


async def save_media(content: bytes, filename: str) -> str:
    """
    Save media bytes to disk in the configured upload directory.

    Args:
        content: Raw bytes to write.
        filename: Target filename (e.g., "audio_abc123.ogg").

    Returns:
        Full path to the saved file.
    """
    os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
    file_path = os.path.join(settings.UPLOAD_DIR, filename)

    async with aiofiles.open(file_path, "wb") as f:
        await f.write(content)

    logger.info("[MEDIA] Saved %d bytes to %s", len(content), file_path)
    return file_path
