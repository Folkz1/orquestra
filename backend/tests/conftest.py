"""
Shared fixtures for backend tests.

Async tests use anyio's pytest plugin (ships with httpx/starlette) — mark them
with @pytest.mark.anyio. Only the asyncio backend is exercised.
"""

import os
import sys
import tempfile

import httpx
import pytest

# Make `app.*` importable when running `python -m pytest tests` from backend/
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

FAKE_FF = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fake_ffmpeg.py")


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
def fake_ffmpeg(monkeypatch, tmp_path):
    """
    Point the transcriber at the fake ffmpeg/ffprobe scripts and reset their knobs.
    Returns the path of the invocation log so tests can assert on argv.
    """
    log = tmp_path / "ff.log"
    py = sys.executable
    # Keep every mkdtemp() of the transcriber inside this test's tmp_path so
    # tests can assert that no orquestra_* directory is left behind.
    monkeypatch.setattr(tempfile, "tempdir", str(tmp_path))
    monkeypatch.setenv("ORQ_FFMPEG", f'"{py}" "{FAKE_FF}" ffmpeg')
    monkeypatch.setenv("ORQ_FFPROBE", f'"{py}" "{FAKE_FF}" ffprobe')
    monkeypatch.setenv("FAKE_FF_LOG", str(log))
    for var in ("FAKE_FF_SLEEP", "FAKE_FF_OUT_BYTES", "FAKE_FF_PROBE_OUT"):
        monkeypatch.delenv(var, raising=False)
    return log


@pytest.fixture
def http_mock(monkeypatch):
    """
    Replace httpx.AsyncClient inside the transcriber module with one backed by a
    MockTransport. Returns a recorder: .calls (list of httpx.Request) and .responder
    (callable request -> Response) that tests may override.
    """
    from app.services import transcriber

    class Recorder:
        def __init__(self):
            self.calls: list[httpx.Request] = []
            self.responder = lambda request: httpx.Response(200, json={"text": "ok"})

        def handler(self, request: httpx.Request) -> httpx.Response:
            self.calls.append(request)
            return self.responder(request)

        def urls(self) -> list[str]:
            return [str(c.url) for c in self.calls]

    rec = Recorder()
    real_client = httpx.AsyncClient

    def factory(**kwargs):
        kwargs.pop("transport", None)
        return real_client(transport=httpx.MockTransport(rec.handler), **kwargs)

    monkeypatch.setattr(transcriber.httpx, "AsyncClient", factory)
    return rec


@pytest.fixture
def keys(monkeypatch):
    """Configure API keys on the settings singleton (both present by default)."""
    from app.services import transcriber

    def _set(groq: str = "gsk_test", openrouter: str = "sk-or-test"):
        monkeypatch.setattr(transcriber.settings, "GROQ_API_KEY", groq)
        monkeypatch.setattr(transcriber.settings, "OPENROUTER_API_KEY", openrouter)

    _set()
    return _set


def make_file(path, size: int) -> str:
    """Create a sparse file of `size` bytes and return its path as str."""
    with open(path, "wb") as f:
        f.truncate(size)
    return str(path)


def leftover_temp_dirs(tmp_path) -> list[str]:
    """orquestra_* directories the transcriber left behind under tmp_path."""
    return sorted(p.name for p in tmp_path.iterdir() if p.is_dir() and p.name.startswith("orquestra_"))
