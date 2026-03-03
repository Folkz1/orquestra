"""
Orquestra - FastAPI Application Entry Point
"""

import logging
import os
from contextlib import asynccontextmanager

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


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown events."""
    # Create upload directory
    os.makedirs(settings.UPLOAD_DIR, exist_ok=True)

    # Run Alembic migrations on startup
    try:
        import subprocess
        result = subprocess.run(
            ["alembic", "upgrade", "head"],
            capture_output=True,
            text=True,
            timeout=60,
        )
        if result.returncode == 0:
            logger.info("[MAIN] Alembic migrations OK: %s", result.stdout.strip()[:200])
        else:
            logger.error("[MAIN] Alembic migration failed: %s | %s", result.stdout[:200], result.stderr[:200])
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

    # Exempt paths (exact or prefix match for webhooks)
    if path in EXEMPT_PATHS or path.startswith("/api/webhook"):
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
    from app.database import async_session_maker
    from sqlalchemy import text
    try:
        async with async_session_maker() as session:
            result = await session.execute(text("SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name"))
            tables = [row[0] for row in result.fetchall()]
        return {"status": "ok", "tables": tables}
    except Exception as e:
        return {"status": "error", "error": str(e)}


# -- Include Routers --

from app.routers import webhook, contacts, messages, recordings, projects, briefs, memory, youtube  # noqa: E402

app.include_router(webhook.router, prefix="/api/webhook", tags=["Webhook"])
app.include_router(contacts.router, prefix="/api/contacts", tags=["Contacts"])
app.include_router(messages.router, prefix="/api/messages", tags=["Messages"])
app.include_router(recordings.router, prefix="/api/recordings", tags=["Recordings"])
app.include_router(projects.router, prefix="/api/projects", tags=["Projects"])
app.include_router(briefs.router, prefix="/api/briefs", tags=["Daily Briefs"])
app.include_router(memory.router, prefix="/api/memory", tags=["Memory"])
app.include_router(youtube.router, prefix="/api/youtube", tags=["YouTube"])
