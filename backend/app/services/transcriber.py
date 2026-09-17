"""
Orquestra - Transcription & Vision Service
Audio transcription via Groq Whisper (ffmpeg compress/chunk to fit the 25MB limit),
with OpenRouter as fallback. Image description via OpenRouter.

ffmpeg/ffprobe always run as *async subprocesses*: a 1h recording from the PWA
takes minutes to re-encode on a loaded box, and running that synchronously used
to freeze the whole event loop — /api/health stopped answering and Docker killed
the container mid-transcription (2026-09-17, recording d198a1b1).
"""

import asyncio
import base64
import logging
import os
import platform
import shlex
import shutil
import tempfile

import httpx
import fitz  # pymupdf

from app.config import settings

logger = logging.getLogger(__name__)

# Groq Whisper limit is 25MB. Use 20min chunks to stay safe.
CHUNK_DURATION_SECONDS = 20 * 60  # 20 minutes
MAX_FILE_SIZE_BYTES = 24 * 1024 * 1024  # 24MB (safe margin under 25MB)

# Voice recordings: mono Opus at 32 kbps is transparent for speech and gives
# ~14MB per hour, so anything under ~1h40 fits Groq in a single request.
COMPRESS_BITRATE = "32k"
COMPRESS_BITRATE_BPS = 32_000
# Re-encoding is ~1x-2x realtime on a busy 8-core box; 2h40 of audio (longest
# call so far) needs ~10 min. Nothing blocks while we wait, so be generous.
COMPRESS_TIMEOUT_SECONDS = 15 * 60
PROBE_TIMEOUT_SECONDS = 30


def _tool_cmd(env_var: str, default: str) -> list[str]:
    """
    Command prefix for ffmpeg/ffprobe. Overridable via env (ORQ_FFMPEG / ORQ_FFPROBE)
    so tests can swap in a fake — the value is shell-split, e.g. '"python" "fake.py" ffmpeg'.
    """
    return shlex.split(os.environ.get(env_var) or default, posix=True)


def _ffmpeg_cmd() -> list[str]:
    cmd = _tool_cmd("ORQ_FFMPEG", "ffmpeg")
    # Don't starve the API (and the other containers) on the shared box.
    if platform.system() != "Windows" and shutil.which("nice"):
        cmd = ["nice", "-n", "10", *cmd]
    return cmd


def _ffprobe_cmd() -> list[str]:
    return _tool_cmd("ORQ_FFPROBE", "ffprobe")


async def _run(cmd: list[str], timeout: float) -> tuple[int, str, str]:
    """
    Run a command without blocking the event loop. Kills it on timeout or on
    task cancellation (the router wraps us in asyncio.wait_for) so no orphan
    ffmpeg keeps burning CPU after we gave up on it.
    """
    proc = await asyncio.create_subprocess_exec(
        *cmd, stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    try:
        out, err = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except (asyncio.TimeoutError, asyncio.CancelledError):
        if proc.returncode is None:
            proc.kill()
            await proc.wait()
        raise
    return proc.returncode or 0, out.decode(errors="replace"), err.decode(errors="replace")


async def _probe_duration(file_path: str) -> float | None:
    """
    Duration in seconds via ffprobe, or None when unknown. WebM written by the
    browser's MediaRecorder has no duration in the header, so ffprobe prints
    "N/A" for it — that is expected, not an error.
    """
    cmd = [
        *_ffprobe_cmd(), "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        file_path,
    ]
    try:
        _, out, _ = await _run(cmd, timeout=PROBE_TIMEOUT_SECONDS)
        return float(out.strip())
    except (ValueError, asyncio.TimeoutError, OSError) as exc:
        logger.info("[TRANSCRIBER] Duration unknown for %s (%s)", os.path.basename(file_path), exc)
        return None


async def _transcribe_single(file_path: str) -> str:
    """Transcribe a single audio file via Groq Whisper API."""
    url = "https://api.groq.com/openai/v1/audio/transcriptions"
    headers = {"Authorization": f"Bearer {settings.GROQ_API_KEY}"}

    filename = os.path.basename(file_path)

    async with httpx.AsyncClient(timeout=180.0) as client:
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


async def _transcribe_via_openrouter(file_path: str) -> str:
    """Transcribe audio via OpenRouter chat completions with input_audio (no 25MB limit)."""
    url = f"{settings.OPENROUTER_BASE_URL}/chat/completions"
    headers = {
        "Authorization": f"Bearer {settings.OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
    }

    # Read and base64-encode the audio file
    with open(file_path, "rb") as f:
        audio_b64 = base64.b64encode(f.read()).decode("utf-8")

    # Detect format from extension
    ext = os.path.splitext(file_path)[1].lstrip(".").lower()
    fmt_map = {"webm": "ogg", "opus": "ogg", "m4a": "m4a", "mp3": "mp3", "wav": "wav"}
    audio_format = fmt_map.get(ext, "ogg")

    payload = {
        "model": settings.MODEL_TRANSCRIPTION,
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": "Transcreva este audio completamente em portugues. Retorne APENAS a transcricao, sem comentarios.",
                    },
                    {
                        "type": "input_audio",
                        "input_audio": {
                            "data": audio_b64,
                            "format": audio_format,
                        },
                    },
                ],
            }
        ],
        "max_tokens": 16000,
        "temperature": 0.0,
    }

    async with httpx.AsyncClient(timeout=600.0) as client:
        response = await client.post(url, headers=headers, json=payload)
        response.raise_for_status()

    data = response.json()
    text = data["choices"][0]["message"]["content"].strip()
    logger.info("[TRANSCRIBER] OpenRouter transcribed %s -> %d chars", os.path.basename(file_path), len(text))
    return text


def _cleanup_temp_file(file_path: str):
    """Remove a temporary file (if it exists) and its orquestra_* parent directory if empty."""
    try:
        if os.path.exists(file_path):
            os.remove(file_path)
    except OSError:
        pass
    parent = os.path.dirname(file_path)
    if parent and os.path.basename(parent).startswith("orquestra_"):
        try:
            os.rmdir(parent)
        except OSError:
            pass


async def _compress_audio(file_path: str, timeout: float = COMPRESS_TIMEOUT_SECONDS) -> str:
    """
    Re-encode to mono OGG Opus (voice profile) so the file fits under Groq's 25MB limit.
    Returns the compressed path, or the original path if ffmpeg fails or times out.
    """
    file_size = os.path.getsize(file_path)
    tmp_dir = tempfile.mkdtemp(prefix="orquestra_compress_")
    compressed_path = os.path.join(tmp_dir, "compressed.ogg")

    cmd = [
        *_ffmpeg_cmd(), "-y", "-nostdin", "-loglevel", "error",
        "-i", file_path,
        "-vn", "-ac", "1",
        "-c:a", "libopus", "-b:a", COMPRESS_BITRATE, "-application", "voip",
        compressed_path,
    ]
    try:
        code, _, err = await _run(cmd, timeout=timeout)
        if code == 0 and os.path.exists(compressed_path) and os.path.getsize(compressed_path) > 0:
            new_size = os.path.getsize(compressed_path)
            logger.info(
                "[TRANSCRIBER] Compressed %.1fMB -> %.1fMB",
                file_size / (1024 * 1024), new_size / (1024 * 1024),
            )
            return compressed_path
        logger.error("[TRANSCRIBER] ffmpeg compression failed (exit %s): %s", code, err.strip()[-300:])
    except asyncio.TimeoutError:
        logger.error(
            "[TRANSCRIBER] ffmpeg compression timed out after %.0fs for %.1fMB file",
            timeout, file_size / (1024 * 1024),
        )
    except OSError as exc:
        logger.error("[TRANSCRIBER] ffmpeg not runnable: %s", exc)

    _cleanup_temp_file(compressed_path)
    return file_path


async def _split_audio_chunks(
    file_path: str, duration: float, chunk_seconds: int = CHUNK_DURATION_SECONDS
) -> list[str]:
    """
    Cut an (already compressed) audio file into chunks of `chunk_seconds`.
    Returns the chunk paths; falls back to [file_path] if nothing could be cut.
    """
    tmp_dir = tempfile.mkdtemp(prefix="orquestra_chunks_")
    chunk_paths: list[str] = []
    start = 0
    chunk_index = 0

    while start < duration:
        chunk_path = os.path.join(tmp_dir, f"chunk_{chunk_index:03d}.ogg")
        cmd = [
            *_ffmpeg_cmd(), "-y", "-nostdin", "-loglevel", "error",
            "-ss", str(start), "-t", str(chunk_seconds),
            "-i", file_path,
            "-vn", "-ac", "1",
            "-c:a", "libopus", "-b:a", COMPRESS_BITRATE, "-application", "voip",
            chunk_path,
        ]
        try:
            code, _, err = await _run(cmd, timeout=COMPRESS_TIMEOUT_SECONDS)
            if code == 0 and os.path.exists(chunk_path) and os.path.getsize(chunk_path) > 0:
                chunk_paths.append(chunk_path)
            else:
                logger.error("[TRANSCRIBER] ffmpeg chunk %d failed (exit %s): %s", chunk_index, code, err.strip()[-300:])
        except (asyncio.TimeoutError, OSError) as exc:
            logger.error("[TRANSCRIBER] ffmpeg chunk %d failed: %s", chunk_index, exc)

        start += chunk_seconds
        chunk_index += 1

    logger.info("[TRANSCRIBER] Split %.0fs audio into %d chunks", duration, len(chunk_paths))
    return chunk_paths if chunk_paths else [file_path]


async def _transcribe_chunks_via_groq(file_path: str) -> str:
    """Compress, split by duration and transcribe each piece with Groq. Concatenates the text."""
    compressed_path = await _compress_audio(file_path)
    use_compressed = compressed_path != file_path
    compressed_size = os.path.getsize(compressed_path)

    try:
        if compressed_size <= MAX_FILE_SIZE_BYTES:
            logger.info(
                "[TRANSCRIBER] Compressed file fits Groq limit (%.1fMB), sending directly...",
                compressed_size / (1024 * 1024),
            )
            return await _transcribe_single(compressed_path)

        duration = await _probe_duration(compressed_path)
        if duration is None:
            # No header duration (browser WebM): estimate from size at the
            # bitrate we encode at, rounded up so the tail is never lost.
            duration = compressed_size * 8 / COMPRESS_BITRATE_BPS * 1.1
            logger.info("[TRANSCRIBER] Estimated duration %.0fs from size", duration)

        logger.info("[TRANSCRIBER] Splitting %s into chunks...", os.path.basename(file_path))
        chunks = await _split_audio_chunks(compressed_path, duration)

        transcriptions: list[str] = []
        failed_chunks = 0
        for i, chunk_path in enumerate(chunks):
            try:
                logger.info("[TRANSCRIBER] Transcribing chunk %d/%d...", i + 1, len(chunks))
                text = await _transcribe_single(chunk_path)
                if text:
                    transcriptions.append(text)
            except Exception as exc:
                logger.error("[TRANSCRIBER] Chunk %d/%d failed: %s", i + 1, len(chunks), exc)
                failed_chunks += 1
            finally:
                if chunk_path not in (file_path, compressed_path):
                    _cleanup_temp_file(chunk_path)

        if not transcriptions:
            raise RuntimeError(
                f"All {len(chunks)} transcription chunks failed. No audio content could be extracted."
            )
        if failed_chunks:
            logger.warning(
                "[TRANSCRIBER] Partial transcription: %d/%d chunks succeeded.",
                len(transcriptions), len(chunks),
            )

        full_text = " ".join(transcriptions)
        logger.info(
            "[TRANSCRIBER] Chunked transcription: %d/%d chunks -> %d chars",
            len(transcriptions), len(chunks), len(full_text),
        )
        return full_text
    finally:
        if use_compressed:
            _cleanup_temp_file(compressed_path)


async def _transcribe_via_openrouter_compressed(file_path: str) -> str:
    """OpenRouter route: compress first (smaller base64 payload), then send in one request."""
    compressed_path = file_path
    if os.path.getsize(file_path) > MAX_FILE_SIZE_BYTES:
        compressed_path = await _compress_audio(file_path)
    try:
        return await _transcribe_via_openrouter(compressed_path)
    finally:
        if compressed_path != file_path:
            _cleanup_temp_file(compressed_path)


async def transcribe_audio(file_path: str) -> str:
    """
    Transcribe an audio file.

    Strategy (Groq first — it is fast, cheap and has proper Whisper):
    - Small files (≤24MB): Groq Whisper directly.
    - Large files (>24MB): re-encode to mono Opus 32k; if it fits, one Groq
      request, otherwise split into 20-min chunks and transcribe each.
    - OpenRouter (input_audio chat completion) only as fallback when Groq is
      not configured or fails.

    Args:
        file_path: Path to the audio file on disk.

    Returns:
        Transcription text.
    """
    has_groq = bool(settings.GROQ_API_KEY)
    has_openrouter = bool(settings.OPENROUTER_API_KEY)

    if not has_groq and not has_openrouter:
        raise RuntimeError(
            "No transcription API key configured. Set GROQ_API_KEY or OPENROUTER_API_KEY."
        )

    file_size = os.path.getsize(file_path)
    name = os.path.basename(file_path)

    if has_groq:
        try:
            if file_size <= MAX_FILE_SIZE_BYTES:
                return await _transcribe_single(file_path)
            logger.info(
                "[TRANSCRIBER] File %s is %.1fMB, compressing before transcription...",
                name, file_size / (1024 * 1024),
            )
            return await _transcribe_chunks_via_groq(file_path)
        except Exception as exc:
            if not has_openrouter:
                raise
            logger.warning("[TRANSCRIBER] Groq failed for %s: %s. Falling back to OpenRouter...", name, exc)

    return await _transcribe_via_openrouter_compressed(file_path)

async def describe_image(image_bytes: bytes, mimetype: str = "image/jpeg") -> str:
    """
    Describe an image using OpenRouter vision model.

    Args:
        image_bytes: Raw image bytes.
        mimetype: MIME type of the image (default: image/jpeg).

    Returns:
        Description text in Portuguese.
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


def _extract_pdf(file_path: str) -> str:
    """Extract text from PDF using PyMuPDF."""
    doc = fitz.open(file_path)
    text_parts = [page.get_text() for page in doc]
    num_pages = len(doc)
    doc.close()
    text = "\n".join(text_parts).strip()
    logger.info("[TRANSCRIBER] PDF text: %d chars from %d pages", len(text), num_pages)
    return text


async def _ocr_pdf_via_vision(file_path: str) -> str:
    """Render PDF pages as images and OCR via vision model."""
    doc = fitz.open(file_path)
    descriptions = []
    max_pages = min(len(doc), 10)

    for i in range(max_pages):
        page = doc[i]
        pix = page.get_pixmap(dpi=200)
        img_bytes = pix.tobytes("png")
        desc = await describe_image(img_bytes, "image/png")
        if desc:
            descriptions.append(f"[Pagina {i + 1}]\n{desc}")

    doc.close()
    result = "\n\n".join(descriptions)
    logger.info("[TRANSCRIBER] PDF OCR via vision: %d pages -> %d chars", max_pages, len(result))
    return result


def _extract_docx(file_path: str) -> str:
    """Extract text from DOCX (Word)."""
    from docx import Document

    doc = Document(file_path)
    parts = []
    for para in doc.paragraphs:
        if para.text.strip():
            parts.append(para.text)
    # Also extract text from tables
    for table in doc.tables:
        for row in table.rows:
            cells = [cell.text.strip() for cell in row.cells if cell.text.strip()]
            if cells:
                parts.append(" | ".join(cells))
    text = "\n".join(parts).strip()
    logger.info("[TRANSCRIBER] DOCX text: %d chars", len(text))
    return text


def _extract_xlsx(file_path: str) -> str:
    """Extract text from XLSX (Excel)."""
    from openpyxl import load_workbook

    wb = load_workbook(file_path, read_only=True, data_only=True)
    parts = []
    for sheet_name in wb.sheetnames:
        ws = wb[sheet_name]
        parts.append(f"[Planilha: {sheet_name}]")
        for row in ws.iter_rows(values_only=True):
            cells = [str(c) for c in row if c is not None]
            if cells:
                parts.append(" | ".join(cells))
    wb.close()
    text = "\n".join(parts).strip()
    logger.info("[TRANSCRIBER] XLSX text: %d chars", len(text))
    return text


def _extract_pptx(file_path: str) -> str:
    """Extract text from PPTX (PowerPoint)."""
    from pptx import Presentation

    prs = Presentation(file_path)
    parts = []
    for i, slide in enumerate(prs.slides, 1):
        slide_texts = []
        for shape in slide.shapes:
            if shape.has_text_frame:
                for para in shape.text_frame.paragraphs:
                    if para.text.strip():
                        slide_texts.append(para.text)
            if shape.has_table:
                for row in shape.table.rows:
                    cells = [cell.text.strip() for cell in row.cells if cell.text.strip()]
                    if cells:
                        slide_texts.append(" | ".join(cells))
        if slide_texts:
            parts.append(f"[Slide {i}]\n" + "\n".join(slide_texts))
    text = "\n\n".join(parts).strip()
    logger.info("[TRANSCRIBER] PPTX text: %d chars from %d slides", len(text), len(prs.slides))
    return text


def _extract_plain_text(file_path: str) -> str:
    """Read file as plain text (TXT, CSV, JSON, XML, HTML, MD, etc.)."""
    encodings = ["utf-8", "latin-1", "cp1252"]
    for enc in encodings:
        try:
            with open(file_path, "r", encoding=enc) as f:
                text = f.read(500_000)  # Max 500KB of text
            logger.info("[TRANSCRIBER] Plain text: %d chars (%s)", len(text), enc)
            return text.strip()
        except (UnicodeDecodeError, ValueError):
            continue
    return ""


# Extensions that can be read as plain text
PLAIN_TEXT_EXTENSIONS = {
    ".txt", ".csv", ".json", ".xml", ".html", ".htm", ".md",
    ".yaml", ".yml", ".log", ".ini", ".cfg", ".conf", ".toml",
    ".py", ".js", ".ts", ".sql", ".sh", ".bat", ".css",
}

# MIME types mapped to format
MIME_FORMAT_MAP = {
    "application/pdf": "pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/msword": "doc",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "application/vnd.ms-excel": "xls",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
    "application/vnd.ms-powerpoint": "ppt",
    "text/plain": "txt",
    "text/csv": "csv",
    "application/json": "json",
    "text/html": "html",
    "text/xml": "xml",
    "application/xml": "xml",
}


def _detect_format(file_path: str, mimetype: str | None) -> str:
    """Detect document format from extension and mimetype."""
    ext = os.path.splitext(file_path)[1].lower()

    # Extension-based detection
    ext_map = {
        ".pdf": "pdf",
        ".docx": "docx", ".doc": "doc",
        ".xlsx": "xlsx", ".xls": "xls",
        ".pptx": "pptx", ".ppt": "ppt",
    }
    if ext in ext_map:
        return ext_map[ext]
    if ext in PLAIN_TEXT_EXTENSIONS:
        return "text"

    # MIME-based fallback
    if mimetype:
        mime_lower = mimetype.lower()
        if mime_lower in MIME_FORMAT_MAP:
            return MIME_FORMAT_MAP[mime_lower]
        if mime_lower.startswith("text/"):
            return "text"

    return "unknown"


async def extract_document_text(file_path: str, mimetype: str | None = None) -> str:
    """
    Extract text from any document file.

    Supported formats:
    - PDF: PyMuPDF text extraction, vision OCR fallback for scanned docs
    - DOCX: python-docx (paragraphs + tables)
    - XLSX: openpyxl (all sheets, all rows)
    - PPTX: python-pptx (all slides, shapes + tables)
    - TXT/CSV/JSON/XML/HTML/MD/code: plain text read
    - DOC/XLS/PPT (legacy Office): vision OCR via rendered pages
    - Unknown: skip

    Args:
        file_path: Path to the document file on disk.
        mimetype: MIME type of the document.

    Returns:
        Extracted text content.
    """
    fmt = _detect_format(file_path, mimetype)
    logger.info("[TRANSCRIBER] Document format detected: %s (mime=%s)", fmt, mimetype)

    try:
        if fmt == "pdf":
            text = _extract_pdf(file_path)
            # If scanned PDF (little text), try vision OCR
            if len(text) < 100 and settings.OPENROUTER_API_KEY:
                logger.info("[TRANSCRIBER] PDF has little text (%d chars), trying vision OCR...", len(text))
                ocr_text = await _ocr_pdf_via_vision(file_path)
                return ocr_text if ocr_text else text
            return text

        if fmt == "docx":
            return _extract_docx(file_path)

        if fmt == "xlsx":
            return _extract_xlsx(file_path)

        if fmt == "pptx":
            return _extract_pptx(file_path)

        if fmt == "text":
            return _extract_plain_text(file_path)

        # Legacy Office formats (doc/xls/ppt) - no native parser, try vision
        if fmt in ("doc", "xls", "ppt") and settings.OPENROUTER_API_KEY:
            logger.info("[TRANSCRIBER] Legacy Office format %s, trying PyMuPDF render...", fmt)
            try:
                # PyMuPDF can open some legacy formats
                text = _extract_pdf(file_path)
                if len(text) > 50:
                    return text
                return await _ocr_pdf_via_vision(file_path)
            except Exception:
                logger.warning("[TRANSCRIBER] PyMuPDF can't handle %s format", fmt)
                return ""

        logger.info("[TRANSCRIBER] Unsupported document format: %s", fmt)
        return ""

    except Exception as exc:
        logger.error("[TRANSCRIBER] Document extraction failed for %s: %s", fmt, exc)
        return ""
