"""
Orquestra - FastAPI Application Entry Point
"""

import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import settings

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

APP_ROOT = Path("/app")
if not (APP_ROOT / "alembic.ini").exists():
    APP_ROOT = Path(__file__).resolve().parents[1]
ALEMBIC_INI = APP_ROOT / "alembic.ini"


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown events."""
    # Create upload directory
    os.makedirs(settings.UPLOAD_DIR, exist_ok=True)

    # Run Alembic migrations on startup
    try:
        import subprocess, os as _os
        env = _os.environ.copy()
        env["PYTHONPATH"] = str(APP_ROOT)
        result = subprocess.run(
            ["alembic", "-c", str(ALEMBIC_INI), "upgrade", "head"],
            capture_output=True,
            text=True,
            timeout=120,
            cwd=str(APP_ROOT),
            env=env,
        )
        if result.returncode == 0:
            logger.info("[MAIN] Alembic migrations OK: %s", (result.stdout + result.stderr).strip()[:300])
        else:
            logger.error("[MAIN] Alembic migration FAILED rc=%d: %s",
                result.returncode, (result.stdout + result.stderr)[:500])
    except Exception as exc:
        logger.error("[MAIN] Failed to run alembic: %s", exc)

    # Start APScheduler for daily briefs
    from app.tasks.daily_brief import start_scheduler, shutdown_scheduler

    try:
        start_scheduler()
    except Exception as exc:
        logger.error("[MAIN] Failed to start scheduler: %s", exc)

    logger.info("[MAIN] Orquestra backend started")
    yield

    # Shutdown scheduler
    try:
        shutdown_scheduler()
    except Exception as exc:
        logger.error("[MAIN] Failed to stop scheduler: %s", exc)

    logger.info("[MAIN] Orquestra backend stopped")


app = FastAPI(
    title="Orquestra",
    description="Central hub for WhatsApp messages, voice recordings, and daily briefings",
    version="1.0.0",
    lifespan=lifespan,
)

# -- CORS Middleware --

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# -- Auth Middleware --
# Simple Bearer token check. Webhook routes are exempt.

EXEMPT_PATHS = {
    "/api/health",
    "/api/debug/db",
    "/api/webhook",
    "/api/youtube/briefings/latest",
    "/api/youtube/briefings",
    "/api/youtube/analytics",
    "/api/youtube/oauth/authorize",
    "/api/youtube/oauth/callback",
    "/api/youtube/thumbnails",
    "/docs",
    "/redoc",
    "/openapi.json",
}


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    """Bearer token authentication middleware."""
    # Skip auth if no secret key configured
    if not settings.APP_SECRET_KEY:
        return await call_next(request)

    path = request.url.path

    # Exempt paths (exact or prefix match for webhooks/youtube)
    if (
        path in EXEMPT_PATHS
        or path.startswith("/api/webhook")
        or path.startswith("/api/youtube/briefings/latest/videos")
        or path.startswith("/api/youtube/thumbnails/")
        or path.startswith("/api/youtube/oauth/")
        or path.startswith("/api/proposals/public/")
        or path.startswith("/api/credentials/portal/")
        or path.startswith("/api/client-portal/portal/")
        or path.startswith("/api/playbook/modules")
        or path.startswith("/api/playbook/enroll")
        or path.startswith("/api/playbook/progress")
        or path.startswith("/api/social/oauth/")
        or path == "/api/social/platforms"
        or path.startswith("/api/cliente/")
        or path.startswith("/api/newsletter/subscribe")
        or path.startswith("/api/newsletter/unsubscribe")
    ):
        return await call_next(request)

    # Check Authorization header
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header[7:]
        if token == settings.APP_SECRET_KEY:
            return await call_next(request)

    return JSONResponse(
        status_code=status.HTTP_403_FORBIDDEN,
        content={"detail": "Invalid or missing authentication token"},
    )


# -- Health Check --


@app.get("/api/health")
async def health_check():
    return {
        "status": "ok",
        "service": "orquestra",
        "version": "1.0.0",
    }


@app.get("/api/debug/db")
async def debug_db():
    """Debug endpoint - check DB connectivity and table existence."""
    from app.database import async_session
    from sqlalchemy import text
    import subprocess
    # Run alembic and capture output
    try:
        import os as _os2
        env2 = _os2.environ.copy(); env2["PYTHONPATH"] = str(APP_ROOT)
        result = subprocess.run(
            ["alembic", "-c", str(ALEMBIC_INI), "upgrade", "head"],
            capture_output=True, text=True, timeout=120, cwd=str(APP_ROOT), env=env2,
        )
        alembic_out = result.stdout + result.stderr
        alembic_rc = result.returncode
    except Exception as e:
        alembic_out = str(e)
        alembic_rc = -1
    # Check tables
    try:
        async with async_session() as session:
            result = await session.execute(text("SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name"))
            tables = [row[0] for row in result.fetchall()]
        return {"status": "ok", "tables": tables, "alembic_rc": alembic_rc, "alembic_out": alembic_out}
    except Exception as e:
        return {"status": "error", "error": str(e), "alembic_rc": alembic_rc, "alembic_out": alembic_out}


# -- Include Routers --

from app.routers import webhook, contacts, messages, recordings, projects, briefs, memory, youtube, sync, notion, tasks, assistant, proposals, scheduled_messages, proactive, credentials, client_portal, delivery_reports, ws, playbook, social_publish, subscriptions, cliente, newsletter  # noqa: E402

app.include_router(webhook.router, prefix="/api/webhook", tags=["Webhook"])
app.include_router(contacts.router, prefix="/api/contacts", tags=["Contacts"])
app.include_router(messages.router, prefix="/api/messages", tags=["Messages"])
app.include_router(recordings.router, prefix="/api/recordings", tags=["Recordings"])
app.include_router(projects.router, prefix="/api/projects", tags=["Projects"])
app.include_router(briefs.router, prefix="/api/briefs", tags=["Daily Briefs"])
app.include_router(memory.router, prefix="/api/memory", tags=["Memory"])
app.include_router(youtube.router, prefix="/api/youtube", tags=["YouTube"])
app.include_router(sync.router, prefix="/api/sync", tags=["Sync"])
app.include_router(notion.router, prefix="/api/notion", tags=["Notion"])
app.include_router(tasks.router, prefix="/api/tasks", tags=["Tasks"])
app.include_router(assistant.router, prefix="/api/assistant", tags=["Assistant"])
app.include_router(proposals.router, prefix="/api/proposals", tags=["Proposals"])
app.include_router(delivery_reports.router, prefix="/api", tags=["Delivery Reports"])
app.include_router(scheduled_messages.router, prefix="/api/scheduled-messages", tags=["Scheduled Messages"])
app.include_router(proactive.router, prefix="/api/proactive", tags=["Proactive Bot"])
app.include_router(credentials.router, prefix="/api/credentials", tags=["Credentials Portal"])
app.include_router(client_portal.router, prefix="/api/client-portal", tags=["Client Portal"])
app.include_router(ws.router, prefix="/api/realtime", tags=["Realtime"])
app.include_router(playbook.router, prefix="/api/playbook", tags=["Playbook"])
app.include_router(social_publish.router, prefix="/api/social", tags=["Social Publishing"])
app.include_router(subscriptions.router, prefix="/api/subscriptions", tags=["Subscriptions"])
app.include_router(cliente.router, prefix="/api/cliente", tags=["Cliente Público"])
app.include_router(newsletter.router, prefix="/api/newsletter", tags=["Newsletter"])
