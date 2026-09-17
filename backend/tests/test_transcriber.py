"""
Tests for app.services.transcriber — written against the failure seen in
production on 2026-09-17 (recording d198a1b1, 30.8MB WebM from the PWA):

  1. ffmpeg ran via subprocess.run inside the event loop -> the whole backend
     froze for up to 180s, /api/health stopped answering and Docker killed the
     container (exit 137, "unhealthy").
  2. ffmpeg had a flat 180s timeout that a loaded 8-core box could not meet.
  3. MediaRecorder WebM has no duration in the header -> ffprobe printed "N/A"
     and the chunker crashed on float("N/A").
  4. With Groq available, the OpenRouter route (dead key, 401) was tried first.
"""

import asyncio
import time

import httpx
import pytest

from app.services import transcriber
from tests.conftest import leftover_temp_dirs, make_file

MIB = 1024 * 1024


def _groq_or_openrouter(request: httpx.Request) -> httpx.Response:
    """Default responder: Groq returns {"text"}, OpenRouter returns a chat completion."""
    url = str(request.url)
    if "api.groq.com" in url:
        return httpx.Response(200, json={"text": "via groq"})
    if "openrouter.ai" in url:
        return httpx.Response(
            200, json={"choices": [{"message": {"content": "via openrouter"}}]}
        )
    return httpx.Response(404)


# ---------------------------------------------------------------------------
# ffprobe / ffmpeg primitives
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_probe_duration_returns_none_when_ffprobe_prints_na(fake_ffmpeg, monkeypatch, tmp_path):
    monkeypatch.setenv("FAKE_FF_PROBE_OUT", "N/A")
    src = make_file(tmp_path / "rec.webm", 10)

    assert await transcriber._probe_duration(src) is None


@pytest.mark.anyio
async def test_probe_duration_parses_float(fake_ffmpeg, monkeypatch, tmp_path):
    monkeypatch.setenv("FAKE_FF_PROBE_OUT", "3980.741000")
    src = make_file(tmp_path / "rec.ogg", 10)

    assert await transcriber._probe_duration(src) == pytest.approx(3980.741)


@pytest.mark.anyio
async def test_compress_does_not_block_event_loop(fake_ffmpeg, monkeypatch, tmp_path):
    """While ffmpeg runs (1.5s), other coroutines must keep being scheduled."""
    monkeypatch.setenv("FAKE_FF_SLEEP", "1.5")
    src = make_file(tmp_path / "rec.webm", 25 * MIB)

    ticks = 0

    async def heartbeat():
        nonlocal ticks
        while True:
            await asyncio.sleep(0.05)
            ticks += 1

    hb = asyncio.create_task(heartbeat())
    try:
        out = await transcriber._compress_audio(src)
    finally:
        hb.cancel()

    assert out != src and out.endswith(".ogg")
    # A blocked loop yields ~0 ticks; a free loop yields ~30. Generous floor.
    assert ticks >= 8, f"event loop was blocked during ffmpeg (ticks={ticks})"


@pytest.mark.anyio
async def test_compress_timeout_kills_ffmpeg_and_keeps_original(fake_ffmpeg, monkeypatch, tmp_path):
    monkeypatch.setenv("FAKE_FF_SLEEP", "5")
    src = make_file(tmp_path / "rec.webm", 25 * MIB)

    t0 = time.monotonic()
    out = await transcriber._compress_audio(src, timeout=0.5)
    elapsed = time.monotonic() - t0

    assert out == src, "on timeout the original path must be returned"
    assert elapsed < 3, f"timeout was not enforced (took {elapsed:.1f}s)"
    assert leftover_temp_dirs(tmp_path) == [], "killed ffmpeg must not leave its temp dir behind"


@pytest.mark.anyio
async def test_compress_uses_mono_voice_settings(fake_ffmpeg, tmp_path):
    src = make_file(tmp_path / "rec.webm", 25 * MIB)

    await transcriber._compress_audio(src)

    argv = fake_ffmpeg.read_text(encoding="utf-8")
    assert "-ac 1" in argv, "voice recordings must be downmixed to mono"
    assert "libopus" in argv
    assert "-nostdin" in argv


# ---------------------------------------------------------------------------
# transcribe_audio routing
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_small_file_goes_straight_to_groq_without_ffmpeg(fake_ffmpeg, http_mock, keys, tmp_path):
    http_mock.responder = _groq_or_openrouter
    src = make_file(tmp_path / "small.ogg", 1024)

    text = await transcriber.transcribe_audio(src)

    assert text == "via groq"
    assert [u for u in http_mock.urls() if "groq" in u] and not [u for u in http_mock.urls() if "openrouter" in u]
    assert not fake_ffmpeg.exists(), "no ffmpeg/ffprobe call expected for a small file"


@pytest.mark.anyio
async def test_large_file_is_compressed_then_sent_to_groq_not_openrouter(fake_ffmpeg, http_mock, keys, monkeypatch, tmp_path):
    """30MB WebM -> compress (fits) -> Groq once. OpenRouter must not be touched when Groq exists."""
    http_mock.responder = _groq_or_openrouter
    monkeypatch.setenv("FAKE_FF_OUT_BYTES", str(2 * MIB))
    src = make_file(tmp_path / "rec.webm", 30 * MIB)

    text = await transcriber.transcribe_audio(src)

    assert text == "via groq"
    groq_calls = [c for c in http_mock.calls if "groq" in str(c.url)]
    assert len(groq_calls) == 1
    assert not [c for c in http_mock.calls if "openrouter" in str(c.url)]
    # the file actually uploaded is the compressed .ogg, never the 30MB original
    assert b'filename="compressed.ogg"' in groq_calls[0].content[:2000]
    assert leftover_temp_dirs(tmp_path) == []


@pytest.mark.anyio
async def test_still_large_after_compress_is_chunked_by_probed_duration(fake_ffmpeg, http_mock, keys, monkeypatch, tmp_path):
    """Compressed file still >24MB -> probe the .ogg (has a header) -> N chunks -> N Groq calls."""
    http_mock.responder = _groq_or_openrouter
    monkeypatch.setenv("FAKE_FF_OUT_BYTES", str(25 * MIB))  # compress "fails" to shrink
    monkeypatch.setenv("FAKE_FF_PROBE_OUT", "3000.0")  # 50 min -> 3 chunks of 20 min
    src = make_file(tmp_path / "rec.webm", 90 * MIB)

    text = await transcriber.transcribe_audio(src)

    assert text == "via groq via groq via groq"
    argv = fake_ffmpeg.read_text(encoding="utf-8")
    assert argv.count("-ss ") == 3, argv
    assert "-ss 0 " in argv and "-ss 1200 " in argv and "-ss 2400 " in argv
    assert leftover_temp_dirs(tmp_path) == [], "compressed file and chunks must be cleaned up"


@pytest.mark.anyio
async def test_webm_without_duration_header_still_chunks(fake_ffmpeg, http_mock, keys, monkeypatch, tmp_path):
    """ffprobe says N/A (MediaRecorder WebM): fall back to a bitrate estimate, never crash."""
    http_mock.responder = _groq_or_openrouter
    monkeypatch.setenv("FAKE_FF_OUT_BYTES", str(25 * MIB))
    monkeypatch.setenv("FAKE_FF_PROBE_OUT", "N/A")
    src = make_file(tmp_path / "rec.webm", 90 * MIB)

    text = await transcriber.transcribe_audio(src)

    assert text.startswith("via groq")
    assert len([c for c in http_mock.calls if "groq" in str(c.url)]) >= 2


@pytest.mark.anyio
async def test_groq_failure_falls_back_to_openrouter(fake_ffmpeg, http_mock, keys, tmp_path):
    def responder(request):
        if "groq" in str(request.url):
            return httpx.Response(429, json={"error": "rate limited"})
        return _groq_or_openrouter(request)

    http_mock.responder = responder
    src = make_file(tmp_path / "small.ogg", 1024)

    assert await transcriber.transcribe_audio(src) == "via openrouter"


@pytest.mark.anyio
async def test_without_groq_key_uses_openrouter(fake_ffmpeg, http_mock, keys, tmp_path):
    keys(groq="")
    http_mock.responder = _groq_or_openrouter
    src = make_file(tmp_path / "small.ogg", 1024)

    assert await transcriber.transcribe_audio(src) == "via openrouter"
    assert not [c for c in http_mock.calls if "groq" in str(c.url)]


@pytest.mark.anyio
async def test_no_keys_raises(keys, tmp_path):
    keys(groq="", openrouter="")
    src = make_file(tmp_path / "small.ogg", 1024)

    with pytest.raises(RuntimeError):
        await transcriber.transcribe_audio(src)
