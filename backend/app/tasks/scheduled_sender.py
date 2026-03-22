"""
Orquestra - Scheduled Message Sender
APScheduler job that checks every minute for pending messages
and sends them via Evolution API.
"""

import logging
from datetime import datetime, timezone

from sqlalchemy import and_, select

from app.database import async_session
from app.models import ScheduledMessage
from app.services.whatsapp import send_whatsapp_message

logger = logging.getLogger(__name__)


async def process_scheduled_messages():
    """
    Check for pending messages whose scheduled_for has passed,
    and send them via Evolution API.
    Runs every minute via APScheduler.
    """
    now = datetime.now(timezone.utc)

    async with async_session() as db:
        try:
            stmt = (
                select(ScheduledMessage)
                .where(
                    and_(
                        ScheduledMessage.status == "pending",
                        ScheduledMessage.scheduled_for <= now,
                    )
                )
                .order_by(ScheduledMessage.scheduled_for.asc())
                .limit(50)
                # Each uvicorn worker starts its own scheduler process.
                # Row locking prevents two workers from sending the same
                # pending message before one of them commits "sent".
                .with_for_update(skip_locked=True)
            )
            result = await db.execute(stmt)
            messages = result.scalars().all()

            if not messages:
                return

            logger.info("[SCHEDULED_SENDER] Processing %d pending messages", len(messages))

            for msg in messages:
                try:
                    sent = await send_whatsapp_message(
                        phone=msg.phone,
                        message=msg.message_text,
                        instance=msg.evolution_instance,
                    )

                    if sent:
                        msg.status = "sent"
                        msg.sent_at = datetime.now(timezone.utc)
                        msg.updated_at = datetime.now(timezone.utc)
                        logger.info(
                            "[SCHEDULED_SENDER] Sent message %s to %s",
                            msg.id,
                            msg.phone,
                        )
                    else:
                        msg.status = "failed"
                        msg.error_message = "send_whatsapp_message returned False"
                        msg.updated_at = datetime.now(timezone.utc)
                        logger.error(
                            "[SCHEDULED_SENDER] Failed to send message %s to %s",
                            msg.id,
                            msg.phone,
                        )

                except Exception as exc:
                    msg.status = "failed"
                    msg.error_message = str(exc)[:500]
                    msg.updated_at = datetime.now(timezone.utc)
                    logger.error(
                        "[SCHEDULED_SENDER] Error sending message %s: %s",
                        msg.id,
                        exc,
                    )

            await db.commit()

        except Exception as exc:
            logger.error("[SCHEDULED_SENDER] Job failed: %s", exc)
            await db.rollback()
