"""
Orquestra - Proactive WhatsApp Bot
Analyzes tasks, proposals, contacts, and opportunities daily.
Sends actionable insights to Diego via WhatsApp.
Can create/adjust tasks autonomously.
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
from app.models import Contact, Message, Project, ProjectTask, Proposal
from app.services.llm import chat_completion
from app.services.whatsapp import send_whatsapp_message

logger = logging.getLogger(__name__)

DIEGO_PHONE = "5551934481245"


async def _gather_intelligence(db: AsyncSession) -> dict:
    """Gather all relevant data for proactive analysis."""
    now = datetime.now(timezone.utc)
    seven_days_ago = now - timedelta(days=7)
    three_days_ago = now - timedelta(days=3)

    # 1. Tasks not done, ordered by priority
    tasks_stmt = (
        select(ProjectTask, Project)
        .outerjoin(Project, ProjectTask.project_id == Project.id)
        .where(ProjectTask.status.notin_(["done"]))
        .order_by(
            ProjectTask.priority.desc(),
            ProjectTask.created_at.desc(),
        )
        .limit(30)
    )
    tasks_result = await db.execute(tasks_stmt)
    tasks_raw = tasks_result.all()

    tasks = []
    for task, project in tasks_raw:
        age_days = (now - task.created_at).days
        tasks.append({
            "id": str(task.id),
            "title": task.title,
            "status": task.status,
            "priority": task.priority,
            "assigned_to": task.assigned_to,
            "project": project.name if project else "sem projeto",
            "age_days": age_days,
            "description": (task.description or "")[:200],
            "source": task.source,
        })

    # 2. Open proposals (not accepted/rejected)
    proposals_stmt = (
        select(Proposal)
        .where(Proposal.status.notin_(["accepted", "rejected"]))
        .order_by(Proposal.created_at.desc())
        .limit(20)
    )
    proposals_result = await db.execute(proposals_stmt)
    proposals_raw = proposals_result.scalars().all()

    proposals = []
    for p in proposals_raw:
        days_since_created = (now - p.created_at).days
        days_since_viewed = (now - p.viewed_at).days if p.viewed_at else None
        proposals.append({
            "title": p.title,
            "client": p.client_name,
            "status": p.status,
            "value": p.total_value,
            "days_since_created": days_since_created,
            "days_since_viewed": days_since_viewed,
            "has_been_viewed": p.viewed_at is not None,
        })

    # 3. Contacts needing attention (all non-group, non-ignored with some activity)
    contacts_stmt = (
        select(Contact)
        .where(
            and_(
                Contact.is_group == False,
                Contact.ignored == False,
            )
        )
        .order_by(Contact.engagement_score.desc(), Contact.updated_at.desc())
        .limit(30)
    )
    contacts_result = await db.execute(contacts_stmt)
    contacts_raw = contacts_result.scalars().all()

    contacts = []
    for c in contacts_raw:
        days_since_contact = None
        if c.last_contacted_at:
            days_since_contact = (now - c.last_contacted_at).days

        # Get last 5 messages for each contact (context about what they talked about)
        msgs_stmt = (
            select(Message)
            .where(Message.contact_id == c.id)
            .order_by(Message.timestamp.desc())
            .limit(5)
        )
        msgs_result = await db.execute(msgs_stmt)
        recent_msgs = msgs_result.scalars().all()
        last_messages = []
        for m in recent_msgs:
            direction = "Diego" if m.direction == "outgoing" else (c.name or c.push_name or "cliente")
            content = (m.content or m.transcription or m.message_type or "")[:100]
            last_messages.append(f"{direction}: {content}")

        # Get proposals linked to this contact
        contact_proposals = []
        prop_stmt = select(Proposal).where(Proposal.contact_id == c.id)
        prop_result = await db.execute(prop_stmt)
        for p in prop_result.scalars().all():
            contact_proposals.append({
                "title": p.title,
                "status": p.status,
                "value": p.total_value,
                "viewed": p.viewed_at is not None,
                "days_since_created": (now - p.created_at).days,
            })

        # Message count total
        msg_count_stmt = select(func.count(Message.id)).where(Message.contact_id == c.id)
        count_result = await db.execute(msg_count_stmt)
        total_messages = count_result.scalar() or 0

        contacts.append({
            "name": c.name or c.push_name or c.phone,
            "phone": c.phone,
            "company": c.company,
            "pipeline_stage": c.pipeline_stage,
            "engagement_score": c.engagement_score,
            "days_since_contact": days_since_contact,
            "monthly_revenue": c.monthly_revenue,
            "total_revenue": c.total_revenue,
            "next_action": c.next_action,
            "support_ends_at": c.support_ends_at.strftime("%d/%m/%Y") if c.support_ends_at else None,
            "total_messages": total_messages,
            "last_messages": last_messages,
            "proposals": contact_proposals,
            "notes": (c.notes or "")[:200],
        })

    # 4. Projects overview
    projects_stmt = select(Project).order_by(Project.updated_at.desc()).limit(15)
    projects_result = await db.execute(projects_stmt)
    projects_raw = projects_result.scalars().all()

    projects = []
    for p in projects_raw:
        # Count active tasks per project
        task_count_stmt = select(func.count(ProjectTask.id)).where(
            and_(
                ProjectTask.project_id == p.id,
                ProjectTask.status.notin_(["done"]),
            )
        )
        count_result = await db.execute(task_count_stmt)
        active_tasks = count_result.scalar() or 0

        projects.append({
            "name": p.name,
            "active_tasks": active_tasks,
        })

    # 5. Task stats
    stats_stmt = (
        select(ProjectTask.status, func.count(ProjectTask.id))
        .group_by(ProjectTask.status)
    )
    stats_result = await db.execute(stats_stmt)
    task_stats = {status: count for status, count in stats_result.all()}

    # 6. Recent messages (last 3 days) - count by contact for activity
    recent_msgs_stmt = (
        select(
            Contact.name,
            Contact.push_name,
            Contact.phone,
            func.count(Message.id).label("msg_count"),
            func.max(Message.timestamp).label("last_msg"),
        )
        .join(Contact, Message.contact_id == Contact.id)
        .where(
            and_(
                Message.timestamp >= three_days_ago,
                Message.direction == "incoming",
                Contact.is_group == False,
            )
        )
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
    """Use LLM to generate proactive insights and actions."""
    prompt = f"""Você é o Jarbas, consultor de negócios e CTO virtual do Diego (Guy Folkz).

Diego trabalha com Automação & IA para Negócios (B2B, ticket médio R$4-15k + recorrência).
Meta dele: Motor 100K (R$100k/mês faturamento recorrente).
Canal YouTube: GuyFolkz (IA, automação, licitações).

Sua missão é AUMENTAR O FATURAMENTO do Diego e MELHORAR o valor entregue aos clientes.
Analise TODA a inteligência abaixo como um consultor sênior faria.

DATA: {intelligence['date']}

═══ KANBAN ═══
Backlog: {intelligence['task_stats']['backlog']} | Em progresso: {intelligence['task_stats']['in_progress']} | Review: {intelligence['task_stats']['review']} | Done: {intelligence['task_stats']['done']}

═══ TASKS ABERTAS ═══
{json.dumps(intelligence['tasks'], ensure_ascii=False, indent=1)}

═══ PROPOSTAS PENDENTES ═══
{json.dumps(intelligence['proposals'], ensure_ascii=False, indent=1)}

═══ CLIENTES (análise profunda) ═══
Para cada cliente, analise: conversas recentes, propostas, engagement, tempo sem contato, receita.
Identifique: risco de churn, oportunidade de upsell, necessidade de follow-up, satisfação aparente.

{json.dumps(intelligence['contacts'], ensure_ascii=False, indent=1)}

═══ PROJETOS ═══
{json.dumps(intelligence['projects'], ensure_ascii=False, indent=1)}

═══ ATIVIDADE RECENTE (3 dias) ═══
{json.dumps(intelligence['recent_activity'], ensure_ascii=False, indent=1)}

Gere um JSON com esta estrutura:
{{
  "urgente": [
    {{"acao": "ação concreta e específica", "motivo": "impacto financeiro ou risco", "projeto": "nome", "valor_em_jogo": "R$ estimado"}}
  ],
  "oportunidades": [
    {{"acao": "o que fazer exatamente", "potencial": "R$ valor estimado", "contato": "nome", "estrategia": "como abordar"}}
  ],
  "follow_ups": [
    {{"contato": "nome", "acao": "mensagem ou ação específica a tomar", "dias_sem_contato": 5, "contexto": "último assunto conversado"}}
  ],
  "analise_clientes": [
    {{"cliente": "nome", "saude": "verde|amarelo|vermelho", "diagnostico": "análise curta", "proxima_acao": "ação concreta"}}
  ],
  "tasks_sugeridas": [
    {{"titulo": "título da task", "descricao": "por que essa task é necessária AGORA", "prioridade": "high|medium|low", "projeto": "nome do projeto"}}
  ],
  "resumo_executivo": "3-5 frases como um consultor falaria: situação geral, maiores riscos, maiores oportunidades, prioridade #1 do dia"
}}

REGRAS CRÍTICAS:
1. RECEITA PRIMEIRO: priorize ações que geram ou protegem receita
2. Proposta vista sem resposta >2 dias = follow-up URGENTE (dinheiro na mesa)
3. Cliente sem contato >5 dias com pipeline ativo = risco de churn
4. Task alta prioridade parada >3 dias = bloqueio de entrega
5. Review pendente = Diego precisa testar e liberar
6. Analise cada cliente individualmente: leia as mensagens, entenda o contexto, sugira EXATAMENTE o que dizer
7. tasks_sugeridas: APENAS se detectar necessidade real (máx 3), cada uma deve ter impacto claro
8. Use NOMES REAIS, VALORES REAIS, DATAS REAIS - nada genérico
9. Se detectar que um cliente precisa de algo que Diego pode vender: flag como oportunidade de upsell
10. Responda APENAS o JSON, sem texto extra"""

    response = await chat_completion(
        [{"role": "user", "content": prompt}],
        model=settings.ASSISTANT_CHAT_MODEL,
        temperature=0.3,
        max_tokens=3000,
    )

    # Parse JSON from response
    try:
        match = re.search(r"\{.*\}", response, re.DOTALL)
        if match:
            return json.loads(match.group())
    except (json.JSONDecodeError, AttributeError):
        pass

    logger.error("[PROACTIVE] Failed to parse LLM response: %s", response[:500])
    return {
        "urgente": [],
        "oportunidades": [],
        "follow_ups": [],
        "tasks_sugeridas": [],
        "resumo_executivo": response[:500],
    }


def _format_whatsapp_message(analysis: dict, stats: dict) -> str:
    """Format the analysis into a WhatsApp-friendly message."""
    parts = []
    parts.append("*JARBAS - Relatório Proativo*")
    parts.append(f"_{datetime.now(timezone.utc).strftime('%d/%m/%Y %H:%M')} UTC_")
    parts.append("")

    # Stats line
    parts.append(
        f"Kanban: {stats['backlog']} backlog | "
        f"{stats['in_progress']} em progresso | "
        f"{stats['review']} review | "
        f"{stats['done']} done"
    )
    parts.append("")

    # Executive summary
    resumo = analysis.get("resumo_executivo", "")
    if resumo:
        parts.append(f"*Resumo:* {resumo}")
        parts.append("")

    # Urgent actions
    urgentes = analysis.get("urgente", [])
    if urgentes:
        parts.append("*URGENTE:*")
        for item in urgentes[:5]:
            parts.append(f"  ⚠ {item.get('acao', '?')}")
            if item.get("motivo"):
                parts.append(f"    _{item['motivo']}_")
        parts.append("")

    # Opportunities
    oportunidades = analysis.get("oportunidades", [])
    if oportunidades:
        parts.append("*OPORTUNIDADES:*")
        for item in oportunidades[:3]:
            line = f"  💰 {item.get('acao', '?')}"
            if item.get("potencial"):
                line += f" ({item['potencial']})"
            parts.append(line)
        parts.append("")

    # Follow-ups needed
    follow_ups = analysis.get("follow_ups", [])
    if follow_ups:
        parts.append("*FOLLOW-UP:*")
        for item in follow_ups[:5]:
            days = item.get("dias_sem_contato", "?")
            parts.append(f"  📞 {item.get('contato', '?')} ({days}d sem contato)")
            if item.get("acao"):
                parts.append(f"    → {item['acao']}")
        parts.append("")

    # Client health
    clientes = analysis.get("analise_clientes", [])
    if clientes:
        parts.append("*SAÚDE DOS CLIENTES:*")
        for c in clientes[:6]:
            health = {"verde": "🟢", "amarelo": "🟡", "vermelho": "🔴"}.get(c.get("saude", ""), "⚪")
            parts.append(f"  {health} *{c.get('cliente', '?')}*: {c.get('diagnostico', '?')}")
            if c.get("proxima_acao"):
                parts.append(f"    → {c['proxima_acao']}")
        parts.append("")

    # Suggested tasks
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

        # Find project by name if provided
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

        # Check for duplicate (same title in last 7 days)
        dup_stmt = select(ProjectTask).where(
            and_(
                ProjectTask.title.ilike(f"%{title[:50]}%"),
                ProjectTask.created_at >= datetime.now(timezone.utc) - timedelta(days=7),
            )
        )
        dup_result = await db.execute(dup_stmt)
        if dup_result.scalar_one_or_none():
            logger.info("[PROACTIVE] Skipping duplicate task: %s", title[:50])
            continue

        task = ProjectTask(
            project_id=project_id,
            title=title[:500],
            description=suggestion.get("descricao", "")[:2000] or None,
            status="backlog",
            priority=suggestion.get("prioridade", "medium"),
            source="proactive_bot",
            assigned_to="diego",
        )
        db.add(task)
        created += 1
        logger.info("[PROACTIVE] Created task: %s (project=%s)", title[:50], project_name)

    if created:
        await db.flush()
    return created


async def run_proactive_analysis(db: AsyncSession | None = None) -> dict:
    """
    Main entry point for the proactive bot.
    Can be called from scheduler or manually via API.
    Returns the analysis result.
    """
    own_session = db is None
    if own_session:
        session = async_session()
        db = session
    else:
        session = None

    try:
        logger.info("[PROACTIVE] Starting proactive analysis...")

        # 1. Gather intelligence
        intelligence = await _gather_intelligence(db)
        logger.info(
            "[PROACTIVE] Gathered: %d tasks, %d proposals, %d contacts, %d recent",
            len(intelligence["tasks"]),
            len(intelligence["proposals"]),
            len(intelligence["contacts"]),
            len(intelligence["recent_activity"]),
        )

        # 2. LLM analysis
        analysis = await _analyze_with_llm(intelligence)
        logger.info(
            "[PROACTIVE] Analysis: %d urgent, %d opportunities, %d follow-ups, %d tasks",
            len(analysis.get("urgente", [])),
            len(analysis.get("oportunidades", [])),
            len(analysis.get("follow_ups", [])),
            len(analysis.get("tasks_sugeridas", [])),
        )

        # 3. Create suggested tasks
        tasks_created = 0
        if analysis.get("tasks_sugeridas"):
            tasks_created = await _create_suggested_tasks(db, analysis["tasks_sugeridas"])

        # 4. Format and send WhatsApp message
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
        logger.info("[PROACTIVE] Done. WhatsApp=%s, tasks_created=%d", sent, tasks_created)
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
