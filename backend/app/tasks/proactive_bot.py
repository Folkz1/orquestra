"""
Orquestra - Proactive WhatsApp Bot
Two-phase approach:
1. Client Digest: summarizes full conversations + recordings into contact.notes (runs 1x/day, saves tokens)
2. Proactive Analysis: uses digests + recent activity for actionable insights (runs 2x/day, cheap)
"""

import json
import logging
import re
from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import select, func, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import async_session
from app.models import Contact, Message, Project, ProjectTask, Proposal, Recording
from app.services.llm import chat_completion
from app.services.whatsapp import send_whatsapp_message

logger = logging.getLogger(__name__)

DIEGO_PHONE = "5551934481245"


# ═══════════════════════════════════════════════════════════════════════
# PHASE 1: Client Digest (runs 1x/day at 6h BRT = 9h UTC)
# Summarizes full conversations + recordings → saves in contact.notes
# ═══════════════════════════════════════════════════════════════════════

async def _build_client_digest(db: AsyncSession, contact: Contact) -> str | None:
    """Build a comprehensive digest for a single client from all data sources."""
    now = datetime.now(timezone.utc)
    name = contact.name or contact.push_name or contact.phone

    # 1. Get ALL messages (last 60 days, up to 100)
    msgs_stmt = (
        select(Message)
        .where(
            and_(
                Message.contact_id == contact.id,
                Message.timestamp >= now - timedelta(days=60),
            )
        )
        .order_by(Message.timestamp.asc())
        .limit(100)
    )
    msgs_result = await db.execute(msgs_stmt)
    messages = msgs_result.scalars().all()

    if not messages:
        return None

    # Format conversation
    conversation_lines = []
    for m in messages:
        direction = "Diego" if m.direction == "outgoing" else name
        content = m.content or m.transcription or ""
        if not content and m.message_type != "text":
            content = f"[{m.message_type}]"
        if content:
            ts = m.timestamp.strftime("%d/%m %H:%M") if m.timestamp else ""
            conversation_lines.append(f"[{ts}] {direction}: {content[:500]}")

    # 2. Get recordings/calls related to this contact (by phone match or project)
    recordings_text = ""
    if contact.project_id:
        rec_stmt = (
            select(Recording)
            .where(
                and_(
                    Recording.project_id == contact.project_id,
                    Recording.transcription.isnot(None),
                )
            )
            .order_by(Recording.created_at.desc())
            .limit(5)
        )
        rec_result = await db.execute(rec_stmt)
        recordings = rec_result.scalars().all()

        if recordings:
            rec_parts = []
            for r in recordings:
                title = r.title or "Call sem título"
                ts = r.created_at.strftime("%d/%m/%Y") if r.created_at else ""
                summary = r.summary or ""
                transcript = (r.transcription or "")[:1000]
                action_items = r.action_items or []

                rec_parts.append(f"--- {title} ({ts}) ---")
                if summary:
                    rec_parts.append(f"Resumo: {summary}")
                if action_items:
                    rec_parts.append(f"Ações: {json.dumps(action_items, ensure_ascii=False)}")
                if transcript and not summary:
                    rec_parts.append(f"Transcrição: {transcript}")
                rec_parts.append("")

            recordings_text = "\n".join(rec_parts)

    # 3. Get proposals for context
    prop_stmt = select(Proposal).where(Proposal.contact_id == contact.id)
    prop_result = await db.execute(prop_stmt)
    proposals = prop_result.scalars().all()
    proposals_text = ""
    if proposals:
        prop_parts = []
        for p in proposals:
            prop_parts.append(
                f"- {p.title}: R${p.total_value or '?'} | Status: {p.status} | "
                f"Criada: {p.created_at.strftime('%d/%m/%Y') if p.created_at else '?'} | "
                f"Vista: {'sim' if p.viewed_at else 'não'}"
            )
        proposals_text = "\n".join(prop_parts)

    # 4. Send to LLM for digest
    conversation = "\n".join(conversation_lines)

    prompt = f"""Analise TODA a comunicação com o cliente abaixo e gere um RESUMO EXECUTIVO.

CLIENTE: {name}
EMPRESA: {contact.company or 'não informada'}
TELEFONE: {contact.phone}
PIPELINE: {contact.pipeline_stage or 'indefinido'}
RECEITA MENSAL: {contact.monthly_revenue or 'não definida'}

═══ CONVERSAS WHATSAPP (últimos 60 dias) ═══
{conversation}

{f'═══ GRAVAÇÕES DE CALLS ═══{chr(10)}{recordings_text}' if recordings_text else ''}

{f'═══ PROPOSTAS ═══{chr(10)}{proposals_text}' if proposals_text else ''}

Gere um resumo FACTUAL em formato estruturado. NÃO INVENTE nada que não esteja nas conversas.

Formato obrigatório:
PROJETO: [o que o Diego está fazendo para esse cliente, baseado nas conversas]
VALOR COMBINADO: [valor que foi discutido/fechado nas conversas, ou "não mencionado"]
STATUS REAL: [o que está acontecendo de fato baseado nas últimas mensagens]
PENDÊNCIAS: [o que ficou pendente nas conversas — entregas, pagamentos, decisões]
SATISFAÇÃO: [satisfeito/neutro/insatisfeito — baseado no TOM das mensagens do cliente]
OPORTUNIDADE: [potencial de upsell ou novo serviço identificado nas conversas]
ÚLTIMA INTERAÇÃO: [resumo da última conversa significativa]
CONTEXTO CHAVE: [3-5 fatos importantes sobre o relacionamento que ajudam a tomar decisões]"""

    try:
        digest = await chat_completion(
            [{"role": "user", "content": prompt}],
            model=settings.ASSISTANT_CHAT_MODEL,
            temperature=0.2,
            max_tokens=800,
        )
        return digest.strip()
    except Exception as exc:
        logger.error("[DIGEST] Failed to digest client %s: %s", name, exc)
        return None


async def run_client_digests():
    """
    Phase 1: Update client digests.
    Runs 1x/day. Summarizes conversations + recordings into contact.notes.
    Only processes contacts with activity in the last 30 days.
    """
    async with async_session() as db:
        try:
            now = datetime.now(timezone.utc)
            thirty_days_ago = now - timedelta(days=30)

            # Find contacts with recent messages
            active_contacts_stmt = (
                select(Contact)
                .where(
                    and_(
                        Contact.is_group == False,
                        Contact.ignored == False,
                    )
                )
                .join(Message, Message.contact_id == Contact.id)
                .where(Message.timestamp >= thirty_days_ago)
                .group_by(Contact.id)
                .having(func.count(Message.id) >= 3)
                .order_by(func.max(Message.timestamp).desc())
                .limit(20)
            )
            result = await db.execute(active_contacts_stmt)
            contacts = result.scalars().all()

            logger.info("[DIGEST] Processing %d active contacts", len(contacts))

            updated = 0
            for contact in contacts:
                name = contact.name or contact.push_name or contact.phone
                digest = await _build_client_digest(db, contact)
                if digest:
                    # Prepend date marker and save
                    dated_digest = f"[Atualizado {now.strftime('%d/%m/%Y')}]\n{digest}"
                    contact.notes = dated_digest
                    contact.updated_at = now
                    updated += 1
                    logger.info("[DIGEST] Updated digest for %s", name)

            await db.commit()
            logger.info("[DIGEST] Done. Updated %d/%d contacts", updated, len(contacts))

        except Exception as exc:
            logger.error("[DIGEST] Job failed: %s", exc, exc_info=True)
            await db.rollback()


# ═══════════════════════════════════════════════════════════════════════
# PHASE 2: Proactive Analysis (runs 2x/day at 7h+14h BRT)
# Uses digests (cheap) + latest activity for actionable insights
# ═══════════════════════════════════════════════════════════════════════

async def _gather_intelligence(db: AsyncSession) -> dict:
    """Gather data for proactive analysis — uses digests, not raw conversations."""
    now = datetime.now(timezone.utc)
    three_days_ago = now - timedelta(days=3)

    # 1. Tasks not done
    tasks_stmt = (
        select(ProjectTask, Project)
        .outerjoin(Project, ProjectTask.project_id == Project.id)
        .where(ProjectTask.status.notin_(["done"]))
        .order_by(ProjectTask.priority.desc(), ProjectTask.created_at.desc())
        .limit(30)
    )
    tasks_result = await db.execute(tasks_stmt)
    tasks = []
    for task, project in tasks_result.all():
        tasks.append({
            "id": str(task.id),
            "title": task.title,
            "status": task.status,
            "priority": task.priority,
            "assigned_to": task.assigned_to,
            "project": project.name if project else "sem projeto",
            "age_days": (now - task.created_at).days,
            "description": (task.description or "")[:200],
        })

    # 2. Open proposals
    proposals_stmt = (
        select(Proposal)
        .where(Proposal.status.notin_(["accepted", "rejected"]))
        .order_by(Proposal.created_at.desc())
        .limit(20)
    )
    proposals_result = await db.execute(proposals_stmt)
    proposals = []
    for p in proposals_result.scalars().all():
        proposals.append({
            "title": p.title,
            "client": p.client_name,
            "status": p.status,
            "value": p.total_value,
            "days_since_created": (now - p.created_at).days,
            "days_since_viewed": (now - p.viewed_at).days if p.viewed_at else None,
        })

    # 3. Contacts with DIGESTS (not raw messages — saves tokens)
    contacts_stmt = (
        select(Contact)
        .where(and_(Contact.is_group == False, Contact.ignored == False))
        .order_by(Contact.engagement_score.desc(), Contact.updated_at.desc())
        .limit(25)
    )
    contacts_result = await db.execute(contacts_stmt)
    contacts = []
    for c in contacts_result.scalars().all():
        days_since_contact = None
        if c.last_contacted_at:
            days_since_contact = (now - c.last_contacted_at).days

        # Only get last 5 messages (recent activity, not full history)
        msgs_stmt = (
            select(Message)
            .where(Message.contact_id == c.id)
            .order_by(Message.timestamp.desc())
            .limit(5)
        )
        msgs_result = await db.execute(msgs_stmt)
        recent = []
        for m in reversed(msgs_result.scalars().all()):
            direction = "Diego" if m.direction == "outgoing" else (c.name or "cliente")
            content = (m.content or m.transcription or m.message_type or "")[:150]
            recent.append(f"{direction}: {content}")

        # Get proposals for this contact
        contact_proposals = []
        prop_stmt = select(Proposal).where(Proposal.contact_id == c.id)
        prop_result = await db.execute(prop_stmt)
        for p in prop_result.scalars().all():
            contact_proposals.append({
                "title": p.title,
                "status": p.status,
                "value": p.total_value,
            })

        # Message count
        msg_count_stmt = select(func.count(Message.id)).where(Message.contact_id == c.id)
        total_messages = (await db.execute(msg_count_stmt)).scalar() or 0

        contacts.append({
            "name": c.name or c.push_name or c.phone,
            "phone": c.phone,
            "company": c.company,
            "pipeline_stage": c.pipeline_stage,
            "engagement_score": c.engagement_score,
            "days_since_contact": days_since_contact,
            "monthly_revenue": c.monthly_revenue,
            "next_action": c.next_action,
            "total_messages": total_messages,
            "digest": c.notes or "Sem resumo disponível",  # <-- THE KEY: uses digest, not raw msgs
            "recent_messages": recent,  # only last 5 for "what just happened"
            "proposals": contact_proposals,
        })

    # 4. Projects
    projects_stmt = select(Project).order_by(Project.updated_at.desc()).limit(15)
    projects_result = await db.execute(projects_stmt)
    projects = []
    for p in projects_result.scalars().all():
        task_count_stmt = select(func.count(ProjectTask.id)).where(
            and_(ProjectTask.project_id == p.id, ProjectTask.status.notin_(["done"]))
        )
        active_tasks = (await db.execute(task_count_stmt)).scalar() or 0
        projects.append({"name": p.name, "active_tasks": active_tasks})

    # 5. Task stats
    stats_stmt = select(ProjectTask.status, func.count(ProjectTask.id)).group_by(ProjectTask.status)
    stats_result = await db.execute(stats_stmt)
    task_stats = {status: count for status, count in stats_result.all()}

    # 6. Recent activity (last 3 days)
    recent_msgs_stmt = (
        select(
            Contact.name, Contact.push_name, Contact.phone,
            func.count(Message.id).label("msg_count"),
            func.max(Message.timestamp).label("last_msg"),
        )
        .join(Contact, Message.contact_id == Contact.id)
        .where(and_(
            Message.timestamp >= three_days_ago,
            Message.direction == "incoming",
            Contact.is_group == False,
        ))
        .group_by(Contact.id, Contact.name, Contact.push_name, Contact.phone)
        .order_by(func.count(Message.id).desc())
        .limit(10)
    )
    msgs_result = await db.execute(recent_msgs_stmt)
    recent_activity = [
        {
            "contact": row.name or row.push_name or row.phone,
            "messages": row.msg_count,
            "last": row.last_msg.strftime("%d/%m %H:%M") if row.last_msg else "?",
        }
        for row in msgs_result.all()
    ]

    return {
        "date": now.strftime("%d/%m/%Y %H:%M"),
        "task_stats": {
            "backlog": task_stats.get("backlog", 0),
            "in_progress": task_stats.get("in_progress", 0),
            "review": task_stats.get("review", 0),
            "done": task_stats.get("done", 0),
        },
        "tasks": tasks,
        "proposals": proposals,
        "contacts": contacts,
        "projects": projects,
        "recent_activity": recent_activity,
    }


async def _analyze_with_llm(intelligence: dict) -> dict:
    """Use LLM to generate proactive insights from digests + data."""
    prompt = f"""Você é o Jarbas, braço direito do Diego (Guy Folkz - Automação B2B, ticket R$4-15k + recorrência).
Meta: Motor 100K (R$100k/mês recorrente).

REGRA #1: Só fale o que os DADOS confirmam. Se não tem informação, diga "sem dados".
REGRA #2: Use os DIGESTS dos clientes — eles contêm o resumo real das conversas e acordos.
REGRA #3: Valores só se estiverem no digest ou nas propostas. Nunca invente números.

DATA: {intelligence['date']}

═══ KANBAN ═══
Backlog: {intelligence['task_stats']['backlog']} | Em progresso: {intelligence['task_stats']['in_progress']} | Review: {intelligence['task_stats']['review']} | Done: {intelligence['task_stats']['done']}

═══ TASKS ABERTAS ═══
{json.dumps(intelligence['tasks'], ensure_ascii=False, indent=1)}

═══ PROPOSTAS PENDENTES ═══
{json.dumps(intelligence['proposals'], ensure_ascii=False, indent=1)}

═══ CLIENTES (com digest das conversas reais) ═══
{json.dumps(intelligence['contacts'], ensure_ascii=False, indent=1)}

═══ ATIVIDADE RECENTE (3 dias) ═══
{json.dumps(intelligence['recent_activity'], ensure_ascii=False, indent=1)}

Gere um JSON:
{{
  "urgente": [{{"acao": "...", "motivo": "...", "valor_em_jogo": "R$ se conhecido"}}],
  "oportunidades": [{{"acao": "...", "potencial": "R$...", "contato": "...", "estrategia": "..."}}],
  "follow_ups": [{{"contato": "...", "acao": "...", "dias_sem_contato": N, "contexto": "baseado no digest"}}],
  "analise_clientes": [{{"cliente": "...", "saude": "verde|amarelo|vermelho", "diagnostico": "baseado no digest REAL", "proxima_acao": "..."}}],
  "tasks_sugeridas": [{{"titulo": "...", "descricao": "...", "prioridade": "high|medium|low", "projeto": "..."}}],
  "resumo_executivo": "3-5 frases sobre a situação REAL dos negócios"
}}

PRIORIZE: 1) Receita em risco 2) Propostas paradas 3) Clientes sem contato 4) Oportunidades de upsell
Responda APENAS o JSON."""

    response = await chat_completion(
        [{"role": "user", "content": prompt}],
        model=settings.ASSISTANT_CHAT_MODEL,
        temperature=0.3,
        max_tokens=3000,
    )

    try:
        match = re.search(r"\{.*\}", response, re.DOTALL)
        if match:
            return json.loads(match.group())
    except (json.JSONDecodeError, AttributeError):
        pass

    logger.error("[PROACTIVE] Failed to parse LLM response: %s", response[:500])
    return {
        "urgente": [], "oportunidades": [], "follow_ups": [],
        "tasks_sugeridas": [], "resumo_executivo": response[:500],
    }


def _format_whatsapp_message(analysis: dict, stats: dict) -> str:
    """Format the analysis into a WhatsApp-friendly message."""
    parts = []
    parts.append("*JARBAS - Relatório Proativo*")
    parts.append(f"_{datetime.now(timezone.utc).strftime('%d/%m/%Y %H:%M')} UTC_")
    parts.append("")

    parts.append(
        f"Kanban: {stats['backlog']} backlog | "
        f"{stats['in_progress']} em progresso | "
        f"{stats['review']} review | "
        f"{stats['done']} done"
    )
    parts.append("")

    resumo = analysis.get("resumo_executivo", "")
    if resumo:
        parts.append(f"*Resumo:* {resumo}")
        parts.append("")

    urgentes = analysis.get("urgente", [])
    if urgentes:
        parts.append("*URGENTE:*")
        for item in urgentes[:5]:
            parts.append(f"  ⚠ {item.get('acao', '?')}")
            if item.get("motivo"):
                parts.append(f"    _{item['motivo']}_")
        parts.append("")

    oportunidades = analysis.get("oportunidades", [])
    if oportunidades:
        parts.append("*OPORTUNIDADES:*")
        for item in oportunidades[:3]:
            line = f"  💰 {item.get('acao', '?')}"
            if item.get("potencial"):
                line += f" ({item['potencial']})"
            parts.append(line)
        parts.append("")

    follow_ups = analysis.get("follow_ups", [])
    if follow_ups:
        parts.append("*FOLLOW-UP:*")
        for item in follow_ups[:5]:
            days = item.get("dias_sem_contato", "?")
            parts.append(f"  📞 {item.get('contato', '?')} ({days}d sem contato)")
            if item.get("acao"):
                parts.append(f"    → {item['acao']}")
        parts.append("")

    clientes = analysis.get("analise_clientes", [])
    if clientes:
        parts.append("*SAÚDE DOS CLIENTES:*")
        for c in clientes[:6]:
            health = {"verde": "🟢", "amarelo": "🟡", "vermelho": "🔴"}.get(c.get("saude", ""), "⚪")
            parts.append(f"  {health} *{c.get('cliente', '?')}*: {c.get('diagnostico', '?')}")
            if c.get("proxima_acao"):
                parts.append(f"    → {c['proxima_acao']}")
        parts.append("")

    tasks = analysis.get("tasks_sugeridas", [])
    if tasks:
        parts.append(f"*TASKS CRIADAS ({len(tasks)}):*")
        for t in tasks[:3]:
            prio = {"high": "🔴", "medium": "🟡", "low": "🟢"}.get(t.get("prioridade", "medium"), "🟡")
            parts.append(f"  {prio} {t.get('titulo', '?')}")
        parts.append("")

    parts.append("_Jarbas CTO - Orquestra_")

    message = "\n".join(parts)
    if len(message) > 4000:
        message = message[:3997] + "..."
    return message


async def _create_suggested_tasks(db: AsyncSession, tasks_sugeridas: list[dict]) -> int:
    """Create tasks suggested by the LLM analysis."""
    created = 0
    for suggestion in tasks_sugeridas[:3]:
        title = suggestion.get("titulo", "").strip()
        if not title:
            continue

        project_id = None
        project_name = suggestion.get("projeto", "")
        if project_name:
            proj_stmt = select(Project).where(
                Project.name.ilike(f"%{project_name}%")
            ).limit(1)
            proj_result = await db.execute(proj_stmt)
            proj = proj_result.scalar_one_or_none()
            if proj:
                project_id = proj.id

        # Check for duplicate
        dup_stmt = select(ProjectTask).where(
            and_(
                ProjectTask.title.ilike(f"%{title[:50]}%"),
                ProjectTask.created_at >= datetime.now(timezone.utc) - timedelta(days=7),
            )
        )
        dup_result = await db.execute(dup_stmt)
        if dup_result.scalar_one_or_none():
            continue

        task = ProjectTask(
            project_id=project_id,
            title=title[:500],
            description=suggestion.get("descricao", "")[:2000] or None,
            status="backlog",
            priority=suggestion.get("prioridade", "medium"),
            source="auto",
            assigned_to="diego",
        )
        db.add(task)
        created += 1
        logger.info("[PROACTIVE] Created task: %s", title[:50])

    if created:
        await db.flush()
    return created


async def run_proactive_analysis(db: AsyncSession | None = None) -> dict:
    """Main entry point. Can be called from scheduler or API."""
    own_session = db is None
    if own_session:
        session = async_session()
        db = session
    else:
        session = None

    try:
        logger.info("[PROACTIVE] Starting proactive analysis...")
        intelligence = await _gather_intelligence(db)
        logger.info(
            "[PROACTIVE] Gathered: %d tasks, %d proposals, %d contacts",
            len(intelligence["tasks"]),
            len(intelligence["proposals"]),
            len(intelligence["contacts"]),
        )

        analysis = await _analyze_with_llm(intelligence)
        tasks_created = 0
        if analysis.get("tasks_sugeridas"):
            tasks_created = await _create_suggested_tasks(db, analysis["tasks_sugeridas"])

        message = _format_whatsapp_message(analysis, intelligence["task_stats"])
        phone = settings.OWNER_WHATSAPP or DIEGO_PHONE
        sent = await send_whatsapp_message(phone, message)

        if own_session:
            await db.commit()

        result = {
            "success": True,
            "sent_whatsapp": sent,
            "phone": phone,
            "tasks_created": tasks_created,
            "analysis": analysis,
            "message_preview": message[:500],
            "stats": intelligence["task_stats"],
        }
        logger.info("[PROACTIVE] Done. WhatsApp=%s, tasks=%d", sent, tasks_created)
        return result

    except Exception as exc:
        logger.error("[PROACTIVE] Analysis failed: %s", exc, exc_info=True)
        if own_session:
            await db.rollback()
        return {"success": False, "error": str(exc)}
    finally:
        if own_session and session:
            await session.close()


async def scheduled_proactive_analysis():
    """Entry point for APScheduler (no db parameter)."""
    await run_proactive_analysis()
