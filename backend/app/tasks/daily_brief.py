"""
Orquestra - Daily Brief Scheduled Task
Uses APScheduler to generate and send daily briefs at a configured hour.
"""

import logging
from datetime import datetime, timedelta, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app.config import settings
from app.database import async_session
from app.services.orchestrator import generate_daily_brief, send_telegram_brief
from app.tasks.proactive_bot import scheduled_proactive_analysis, run_client_digests
from app.tasks.scheduled_sender import process_scheduled_messages
from app.tasks.youtube_daily import daily_youtube_analysis
from app.tasks.subscription_alerts import run_subscription_alerts

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler()


async def scheduled_daily_brief():
    """
    Scheduled task: generates a daily brief for the last 24 hours
    and sends it via Telegram.
    Runs at the hour configured by BRIEFING_HOUR.
    """
    logger.info("[DAILY_BRIEF] Starting scheduled daily brief generation...")

    now = datetime.now(timezone.utc)
    date_from = now - timedelta(hours=24)
    date_to = now

    async with async_session() as db:
        try:
            brief_data = await generate_daily_brief(db, date_from, date_to)
            await db.commit()
            logger.info("[DAILY_BRIEF] Brief generated successfully: %s", brief_data.get("id"))

            # Send via Telegram
            sent = await send_telegram_brief(brief_data)
            if sent:
                # Update sent_telegram in DB
                from sqlalchemy import select as sa_select
                from app.models import DailyBrief
                brief_id = brief_data.get("id")
                if brief_id:
                    stmt = sa_select(DailyBrief).where(DailyBrief.id == brief_id)
                    result = await db.execute(stmt)
                    brief_record = result.scalar_one_or_none()
                    if brief_record:
                        brief_record.sent_telegram = True
                        await db.commit()
                logger.info("[DAILY_BRIEF] Telegram notification sent")
            else:
                logger.warning("[DAILY_BRIEF] Telegram notification not sent")

        except Exception as exc:
            logger.error("[DAILY_BRIEF] Scheduled brief generation failed: %s", exc)
            await db.rollback()


def start_scheduler():
    """Start the APScheduler with active jobs only."""

    # ---- PAUSADOS POR DIEGO (2026-03-21) ----
    # Motivo: relatórios automáticos não estão sendo úteis.
    # Para reativar, descomentar os blocos abaixo e fazer redeploy.

    # scheduler.add_job(
    #     scheduled_daily_brief,
    #     "cron",
    #     hour=settings.BRIEFING_HOUR,
    #     minute=0,
    #     id="daily_brief",
    #     replace_existing=True,
    #     timezone="UTC",
    #     max_instances=1,
    #     misfire_grace_time=3600,
    # )

    # scheduler.add_job(
    #     daily_youtube_analysis,
    #     "cron",
    #     hour=8,
    #     minute=0,
    #     id="youtube_analysis",
    #     replace_existing=True,
    #     timezone="UTC",
    #     max_instances=1,
    #     misfire_grace_time=3600,
    # )

    # scheduler.add_job(
    #     run_client_digests,
    #     "cron",
    #     hour=9,
    #     minute=0,
    #     id="client_digests",
    #     replace_existing=True,
    #     timezone="UTC",
    #     max_instances=1,
    #     misfire_grace_time=3600,
    # )

    # scheduler.add_job(
    #     scheduled_proactive_analysis,
    #     "cron",
    #     hour="10,17",
    #     minute=0,
    #     id="proactive_bot",
    #     replace_existing=True,
    #     timezone="UTC",
    #     max_instances=1,
    #     misfire_grace_time=3600,
    # )

    # ---- ATIVOS ----

    # Scheduled messages - check every minute (funcional, envia msgs agendadas)
    scheduler.add_job(
        process_scheduled_messages,
        "interval",
        minutes=1,
        id="scheduled_messages",
        replace_existing=True,
        max_instances=1,           # Prevent overlap if previous run still executing
        misfire_grace_time=30,     # Skip if missed by >30s (don't pile up)
    )

    # Subscription alerts - todo dia 15 às 12:00 UTC (9h BRT)
    scheduler.add_job(
        run_subscription_alerts,
        "cron",
        day=15,
        hour=12,
        minute=0,
        id="subscription_alerts",
        replace_existing=True,
        timezone="UTC",
        max_instances=1,
        misfire_grace_time=3600,   # Allow up to 1h grace for monthly job
    )

    scheduler.start()
    logger.info(
        "[SCHEDULER] Started. ATIVOS: scheduled_messages (1min), subscription_alerts (dia 15). PAUSADOS: daily_brief, youtube, digests, proactive.",
    )


def shutdown_scheduler():
    """Gracefully shutdown the scheduler."""
    if scheduler.running:
        scheduler.shutdown(wait=False)
        logger.info("[DAILY_BRIEF] Scheduler stopped")
