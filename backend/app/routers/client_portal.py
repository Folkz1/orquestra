"""
Client Portal - public project follow-up links for clients.
"""

import html
import logging
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
from app.database import get_db
from app.models import ClientPortalLink, Contact, Project, ProjectTask, Proposal, Recording
from app.services.whatsapp import send_whatsapp_message

logger = logging.getLogger(__name__)
router = APIRouter()

DEFAULT_SECTIONS = ["tasks", "timeline", "proposals", "recordings"]
ALLOWED_SECTIONS = set(DEFAULT_SECTIONS)
ACTIVE_PIPELINE_STAGES = {
    "client",
    "partner",
    "onboarding",
    "building",
    "delivered",
    "maintenance",
    "attention",
}
ALLOWED_FEEDBACK_STATUS = {"idle", "requested", "completed"}
ALLOWED_FEEDBACK_TYPES = {"feedback", "test", "approval"}
TASK_LABELS = {
    "backlog": "Backlog",
    "todo": "Backlog",
    "in_progress": "Em andamento",
    "review": "Em revisao",
    "done": "Concluido",
}
PROPOSAL_LABELS = {
    "draft": "Rascunho",
    "sent": "Enviada",
    "viewed": "Visualizada",
    "accepted": "Aceita",
    "rejected": "Recusada",
}
PROJECT_LABELS = {"active": "Ativo", "paused": "Pausado", "archived": "Arquivado"}
FEEDBACK_STATUS_LABELS = {
    "idle": "Sem checkpoint",
    "requested": "Aguardando retorno",
    "completed": "Retorno concluido",
}
FEEDBACK_TYPE_LABELS = {
    "feedback": "feedback",
    "test": "teste",
    "approval": "aprovacao",
}


class CreateClientPortalLinkRequest(BaseModel):
    project_id: UUID
    contact_id: Optional[UUID] = None
    client_name: str = Field(..., min_length=1, max_length=255)
    visible_sections: Optional[list[str]] = None
    welcome_message: Optional[str] = Field(None, max_length=3000)
    expires_hours: Optional[int] = Field(168, ge=1, le=8760)


class BulkCreateClientPortalLinksRequest(BaseModel):
    visible_sections: Optional[list[str]] = None
    expires_hours: Optional[int] = Field(720, ge=1, le=8760)
    replace_welcome_message: bool = False


class UpdateClientPortalLinkRequest(BaseModel):
    contact_id: Optional[UUID] = None
    client_name: Optional[str] = Field(None, min_length=1, max_length=255)
    visible_sections: Optional[list[str]] = None
    welcome_message: Optional[str] = Field(None, max_length=3000)
    is_active: Optional[bool] = None
    feedback_status: Optional[str] = Field(None, max_length=20)
    feedback_type: Optional[str] = Field(None, max_length=20)
    feedback_title: Optional[str] = Field(None, max_length=255)
    feedback_message: Optional[str] = Field(None, max_length=3000)


class RequestClientPortalFeedbackRequest(BaseModel):
    feedback_type: str = Field("feedback", max_length=20)
    title: Optional[str] = Field(None, max_length=255)
    message: Optional[str] = Field(None, max_length=3000)
    send_whatsapp: bool = True


def _normalize_sections(sections: Optional[list[str]]) -> list[str]:
    if not sections:
        return list(DEFAULT_SECTIONS)
    output = []
    for section in sections:
        key = (section or "").strip().lower()
        if key in ALLOWED_SECTIONS and key not in output:
            output.append(key)
    return output or list(DEFAULT_SECTIONS)


def _normalize_feedback_status(value: Optional[str]) -> str:
    status = (value or "idle").strip().lower()
    if status not in ALLOWED_FEEDBACK_STATUS:
        raise HTTPException(status_code=400, detail="feedback_status invalido")
    return status


def _normalize_feedback_type(value: Optional[str]) -> str:
    feedback_type = (value or "feedback").strip().lower()
    if feedback_type not in ALLOWED_FEEDBACK_TYPES:
        raise HTTPException(status_code=400, detail="feedback_type invalido")
    return feedback_type


def _portal_base_url(request: Request) -> str:
    forwarded_proto = (request.headers.get("x-forwarded-proto") or "").strip()
    forwarded_host = (request.headers.get("x-forwarded-host") or "").strip()
    if forwarded_proto and forwarded_host:
        return f"{forwarded_proto}://{forwarded_host}".rstrip("/")

    configured = (getattr(settings, "CLIENT_PORTAL_URL", "") or "").strip()
    if configured:
        return configured.rstrip("/")

    return str(request.base_url).rstrip("/")


def _safe_color(value: Optional[str]) -> str:
    return value if value and re.fullmatch(r"#[0-9a-fA-F]{6}", value) else "#38bdf8"


def _fmt(value: Optional[datetime]) -> str:
    if not value:
        return ""
    return value.astimezone(timezone.utc).strftime("%d/%m/%Y as %H:%M UTC")


def _iso(value: Optional[datetime]) -> Optional[str]:
    return value.isoformat() if value else None


def _escape(value: Any) -> str:
    return html.escape(str(value or ""))


def _duration(seconds: Any) -> str:
    if not seconds:
        return "Nao informado"
    minutes, remaining = divmod(int(seconds), 60)
    return f"{minutes}min {remaining}s" if minutes else f"{remaining}s"


def _badge(text: str, tone: str) -> str:
    return f'<span class="badge {tone}">{_escape(text)}</span>'


def _normalize_phone(value: Optional[str]) -> str:
    return re.sub(r"\D", "", value or "")


def _extract_text_values(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [value]
    if isinstance(value, dict):
        output: list[str] = []
        for item in value.values():
            output.extend(_extract_text_values(item))
        return output
    if isinstance(value, list):
        output = []
        for item in value:
            output.extend(_extract_text_values(item))
        return output
    return [str(value)]


def _is_client_contact(contact: Contact) -> bool:
    if contact.is_group or getattr(contact, "ignored", False):
        return False
    if (contact.pipeline_stage or "").lower() in ACTIVE_PIPELINE_STAGES:
        return True
    return bool(contact.monthly_revenue or contact.total_revenue or contact.company)


def _default_welcome_message(client_name: str, project_name: str) -> str:
    first_name = (client_name or "cliente").split()[0]
    return (
        f"{first_name}, este portal concentra o andamento do projeto {project_name}. "
        "Sempre que eu liberar uma nova etapa, vou atualizar este link com contexto, tarefas e checkpoints."
    )


def _feedback_defaults(feedback_type: str, project_name: str) -> tuple[str, str]:
    if feedback_type == "test":
        return (
            f"Teste liberado para {project_name}",
            "Esta etapa foi liberada para teste. Preciso que voce valide o fluxo e me responda no WhatsApp com o que aprovou ou o que precisa ajustar.",
        )
    if feedback_type == "approval":
        return (
            f"Aprovacao pendente em {project_name}",
            "Esta etapa esta pronta para aprovacao. Preciso do seu ok para seguir para a proxima entrega.",
        )
    return (
        f"Checkpoint de feedback em {project_name}",
        "Chegamos em um ponto importante do projeto e preciso do seu feedback para continuar com seguranca e velocidade.",
    )


def _feedback_cta(feedback_type: str) -> str:
    if feedback_type == "test":
        return "Teste o que foi liberado e me responda neste mesmo WhatsApp."
    if feedback_type == "approval":
        return "Revise esta etapa e me responda com sua aprovacao ou ajustes."
    return "Revise esta etapa e me responda com seu feedback neste mesmo WhatsApp."


def _feedback_banner_eyebrow(feedback_type: str) -> str:
    if feedback_type == "test":
        return "Teste solicitado"
    if feedback_type == "approval":
        return "Aprovacao solicitada"
    return "Feedback solicitado"


async def _get_contact(contact_id: UUID, db: AsyncSession) -> Contact:
    contact = (await db.execute(select(Contact).where(Contact.id == contact_id))).scalar_one_or_none()
    if not contact:
        raise HTTPException(status_code=404, detail="Contato nao encontrado")
    return contact


async def _get_link(link_id: UUID, db: AsyncSession) -> ClientPortalLink | None:
    result = await db.execute(
        select(ClientPortalLink)
        .options(
            selectinload(ClientPortalLink.project),
            selectinload(ClientPortalLink.contact),
        )
        .where(ClientPortalLink.id == link_id)
    )
    return result.scalar_one_or_none()


async def _get_link_by_token(token: str, db: AsyncSession) -> ClientPortalLink | None:
    result = await db.execute(
        select(ClientPortalLink)
        .options(
            selectinload(ClientPortalLink.project),
            selectinload(ClientPortalLink.contact),
        )
        .where(ClientPortalLink.token == token)
    )
    return result.scalar_one_or_none()


def _validate_public_link(link: ClientPortalLink | None) -> tuple[bool, int, str, str]:
    if not link:
        return False, 404, "Link nao encontrado", "Este link do portal do cliente nao existe ou foi removido."
    if not link.is_active:
        return False, 410, "Link desativado", "Este link foi desativado. Solicite um novo acesso ao Diego."
    if link.expires_at and link.expires_at < datetime.now(timezone.utc):
        return False, 410, "Link expirado", "Este link expirou. Solicite um novo acesso ao Diego."
    return True, 200, "", ""


def _serialize_link(link: ClientPortalLink, request: Request) -> dict[str, Any]:
    return {
        "id": str(link.id),
        "project_id": str(link.project_id),
        "project_name": link.project.name if link.project else None,
        "project_status": link.project.status if link.project else None,
        "project_color": link.project.color if link.project else None,
        "contact_id": str(link.contact_id) if link.contact_id else None,
        "contact_phone": link.contact.phone if link.contact else None,
        "client_name": link.client_name,
        "portal_url": f"{_portal_base_url(request)}/api/client-portal/portal/{link.token}",
        "visible_sections": _normalize_sections(link.visible_sections),
        "welcome_message": link.welcome_message,
        "feedback_status": link.feedback_status or "idle",
        "feedback_type": link.feedback_type or "feedback",
        "feedback_title": link.feedback_title,
        "feedback_message": link.feedback_message,
        "feedback_requested_at": _iso(link.feedback_requested_at),
        "feedback_sent_at": _iso(link.feedback_sent_at),
        "feedback_completed_at": _iso(link.feedback_completed_at),
        "is_active": link.is_active,
        "view_count": link.view_count or 0,
        "last_viewed_at": _iso(link.last_viewed_at),
        "expires_at": _iso(link.expires_at),
        "created_at": _iso(link.created_at),
        "updated_at": _iso(link.updated_at),
    }


def _resolve_contact_project(contact: Contact, active_projects: list[Project], project_by_id: dict[UUID, Project]) -> Project | None:
    if contact.project_id and contact.project_id in project_by_id:
        return project_by_id[contact.project_id]

    phone = _normalize_phone(contact.phone)
    if not phone:
        return None

    for project in active_projects:
        values = _extract_text_values(project.credentials or {})
        if any(phone in _normalize_phone(value) for value in values):
            return project

    return None


def _build_feedback_notification(link: ClientPortalLink, portal_url: str) -> str:
    project_name = link.project.name if link.project else "seu projeto"
    feedback_type = link.feedback_type or "feedback"
    title, default_message = _feedback_defaults(feedback_type, project_name)
    headline = link.feedback_title or title
    body = link.feedback_message or default_message
    client_name = (link.client_name or "cliente").split()[0]

    parts = [
        f"Oi {client_name},",
        "",
        f"Atualizei o portal do projeto {project_name} e estou precisando do seu {FEEDBACK_TYPE_LABELS.get(feedback_type, 'feedback')}.",
        "",
        headline,
        body,
        "",
        "Acesse por aqui:",
        portal_url,
        "",
        _feedback_cta(feedback_type),
        "",
        "- Diego / Orquestra",
    ]
    return "\n".join(parts)


async def _build_payload(link: ClientPortalLink, db: AsyncSession) -> dict[str, Any]:
    sections = _normalize_sections(link.visible_sections)

    tasks = (
        await db.execute(
            select(ProjectTask)
            .where(ProjectTask.project_id == link.project_id)
            .order_by(ProjectTask.created_at.desc())
        )
    ).scalars().all()

    proposal_stmt = select(Proposal).order_by(Proposal.created_at.desc())
    if link.contact_id:
        proposal_stmt = proposal_stmt.where(Proposal.contact_id == link.contact_id)
    else:
        proposal_stmt = (
            select(Proposal)
            .join(Contact, Proposal.contact_id == Contact.id)
            .where(Contact.project_id == link.project_id)
            .order_by(Proposal.created_at.desc())
        )
    proposals = (await db.execute(proposal_stmt)).scalars().all()

    recordings = (
        await db.execute(
            select(Recording)
            .where(Recording.project_id == link.project_id)
            .order_by(Recording.recorded_at.desc())
        )
    ).scalars().all()

    tasks_data = [
        {
            "title": task.title,
            "status": task.status,
            "priority": task.priority,
            "created_at": _iso(task.created_at),
            "completed_at": _iso(task.completed_at),
        }
        for task in tasks
    ]
    proposals_data = [
        {
            "title": proposal.title,
            "status": proposal.status,
            "total_value": proposal.total_value,
            "created_at": _iso(proposal.created_at),
        }
        for proposal in proposals
    ]
    recordings_data = [
        {
            "title": recording.title or "Gravacao sem titulo",
            "summary": recording.summary,
            "duration_seconds": recording.duration_seconds,
            "recorded_at": _iso(recording.recorded_at),
        }
        for recording in recordings
    ]

    timeline = []
    for task in tasks:
        timeline.append(
            {
                "sort": task.created_at,
                "date": _iso(task.created_at),
                "event": "Tarefa criada",
                "description": f"{task.title} entrou no acompanhamento do projeto.",
            }
        )
        if task.status in {"in_progress", "review"} and task.updated_at and task.updated_at > task.created_at:
            timeline.append(
                {
                    "sort": task.updated_at,
                    "date": _iso(task.updated_at),
                    "event": "Status atualizado",
                    "description": f"{task.title} agora esta em {TASK_LABELS.get(task.status, task.status).lower()}.",
                }
            )
        if task.completed_at:
            timeline.append(
                {
                    "sort": task.completed_at,
                    "date": _iso(task.completed_at),
                    "event": "Tarefa concluida",
                    "description": f"{task.title} foi concluida.",
                }
            )
    for recording in recordings:
        timeline.append(
            {
                "sort": recording.recorded_at,
                "date": _iso(recording.recorded_at),
                "event": "Nova gravacao",
                "description": f"{recording.title or 'Gravacao sem titulo'} foi adicionada ao portal.",
            }
        )
    for proposal in proposals:
        timeline.append(
            {
                "sort": proposal.created_at,
                "date": _iso(proposal.created_at),
                "event": "Proposta registrada",
                "description": f"{proposal.title} foi registrada para acompanhamento.",
            }
        )
        if proposal.viewed_at:
            timeline.append(
                {
                    "sort": proposal.viewed_at,
                    "date": _iso(proposal.viewed_at),
                    "event": "Proposta visualizada",
                    "description": f"{proposal.title} foi visualizada.",
                }
            )
        if proposal.accepted_at:
            timeline.append(
                {
                    "sort": proposal.accepted_at,
                    "date": _iso(proposal.accepted_at),
                    "event": "Proposta aceita",
                    "description": f"{proposal.title} foi aceita.",
                }
            )

    timeline_sorted = [
        {"date": item["date"], "event": item["event"], "description": item["description"]}
        for item in sorted(
            timeline,
            key=lambda item: item["sort"] or datetime.min.replace(tzinfo=timezone.utc),
            reverse=True,
        )[:20]
    ]

    status_counts = {
        "backlog": sum(1 for task in tasks_data if task["status"] in {"backlog", "todo"}),
        "in_progress": sum(1 for task in tasks_data if task["status"] == "in_progress"),
        "review": sum(1 for task in tasks_data if task["status"] == "review"),
        "done": sum(1 for task in tasks_data if task["status"] == "done"),
    }
    total_tasks = len(tasks_data)
    done_count = status_counts["done"]
    progress_percent = round((done_count / total_tasks) * 100) if total_tasks else 0
    latest_update = timeline_sorted[0]["date"] if timeline_sorted else None
    project = link.project
    feedback_status = link.feedback_status or "idle"
    feedback_type = link.feedback_type or "feedback"
    default_feedback_title, default_feedback_message = _feedback_defaults(
        feedback_type,
        project.name if project else "seu projeto",
    )

    return {
        "project": {
            "name": project.name if project else "Projeto",
            "description": project.description if project else None,
            "status": project.status if project else "active",
            "color": _safe_color(project.color if project else None),
        },
        "client_name": link.client_name,
        "welcome_message": link.welcome_message
        or _default_welcome_message(link.client_name, project.name if project else "Projeto"),
        "visible_sections": sections,
        "tasks": tasks_data if "tasks" in sections else [],
        "timeline": timeline_sorted if "timeline" in sections else [],
        "proposals": proposals_data if "proposals" in sections else [],
        "recordings": recordings_data if "recordings" in sections else [],
        "summary": {
            "tasks_total": total_tasks,
            "tasks_done": done_count,
            "progress_percent": progress_percent,
            "timeline_total": len(timeline_sorted),
            "proposals_total": len(proposals_data),
            "recordings_total": len(recordings_data),
            "latest_update": latest_update,
        },
        "task_counts": status_counts,
        "feedback": {
            "status": feedback_status,
            "status_label": FEEDBACK_STATUS_LABELS.get(feedback_status, feedback_status),
            "type": feedback_type,
            "type_label": FEEDBACK_TYPE_LABELS.get(feedback_type, feedback_type),
            "title": link.feedback_title or default_feedback_title,
            "message": link.feedback_message or default_feedback_message,
            "requested_at": _iso(link.feedback_requested_at),
            "sent_at": _iso(link.feedback_sent_at),
            "completed_at": _iso(link.feedback_completed_at),
            "cta": _feedback_cta(feedback_type),
            "eyebrow": _feedback_banner_eyebrow(feedback_type),
        },
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }


def _error_html(title: str, message: str) -> str:
    return (
        "<!DOCTYPE html><html lang='pt-BR'><head><meta charset='UTF-8'>"
        "<meta name='viewport' content='width=device-width, initial-scale=1.0'>"
        f"<title>{_escape(title)} - Orquestra</title><style>{_base_css('#38bdf8')}</style></head>"
        f"<body><main class='shell'><section class='hero panel'><span class='eyebrow'>Portal do Cliente</span><h1>{_escape(title)}</h1><p class='lead'>{_escape(message)}</p></section></main></body></html>"
    )


def _base_css(accent: str) -> str:
    return f"""
*{{box-sizing:border-box}}
:root{{--accent:{accent};--muted:#94a3b8;--line:rgba(255,255,255,.09);--panel:rgba(7,13,27,.82);--card:rgba(14,23,41,.72);--ink:#f8fafc}}
body{{margin:0;color:var(--ink);font-family:'Space Grotesk','IBM Plex Sans',system-ui,sans-serif;background:radial-gradient(circle at 12% 18%, rgba(56,189,248,.24), transparent 24%),radial-gradient(circle at 88% 16%, rgba(236,72,153,.16), transparent 22%),radial-gradient(circle at 50% 100%, rgba(34,197,94,.12), transparent 28%),linear-gradient(140deg, #020617 0%, #08101f 42%, #0f172a 100%);min-height:100vh}}
body::before{{content:'';position:fixed;inset:0;pointer-events:none;opacity:.18;background:linear-gradient(rgba(255,255,255,.05) 1px, transparent 1px),linear-gradient(90deg, rgba(255,255,255,.05) 1px, transparent 1px);background-size:28px 28px;mask-image:radial-gradient(circle at center, black 35%, transparent 90%)}}
.shell{{width:min(1180px, calc(100% - 28px));margin:0 auto;padding:28px 0 40px}}
.panel,.section,.metric,.hero-card,.task-card,.timeline-item,.proposal-card,.record-card{{background:linear-gradient(180deg, rgba(12,19,35,.94), rgba(5,10,21,.92));border:1px solid var(--line);border-radius:24px;box-shadow:0 30px 120px rgba(2,6,23,.58);backdrop-filter:blur(20px)}}
.hero{{padding:28px;position:relative;overflow:hidden}} .hero::after{{content:'';position:absolute;inset:auto -80px -120px auto;width:260px;height:260px;border-radius:999px;background:radial-gradient(circle, rgba(255,255,255,.16), transparent 70%);opacity:.45}}
.eyebrow,.pill,.badge{{display:inline-flex;align-items:center;justify-content:center;border-radius:999px;font-weight:700;border:1px solid rgba(255,255,255,.08)}}
.eyebrow{{padding:9px 13px;font-size:11px;text-transform:uppercase;letter-spacing:.18em;color:#dbeafe;background:rgba(15,23,42,.76)}}
.pill{{padding:10px 14px;font-size:12px;text-transform:uppercase;letter-spacing:.08em;background:rgba(15,23,42,.72)}} .pill-accent{{background:linear-gradient(135deg, rgba(56,189,248,.22), rgba(14,165,233,.05));border-color:rgba(125,211,252,.28)}}
.hero-grid{{display:grid;grid-template-columns:minmax(0,1.45fr) minmax(280px,.85fr);gap:18px;margin-top:18px}} .hero-stack,.section-stack,.timeline{{display:grid;gap:14px}}
h1{{margin:16px 0 10px;font-size:clamp(38px,5.5vw,64px);line-height:.96;letter-spacing:-.05em}} .lead{{margin:0;color:#cbd5e1;font-size:16px;line-height:1.75}}
.welcome{{padding:18px 20px;margin-top:18px;background:linear-gradient(135deg, rgba(56,189,248,.15), rgba(255,255,255,.04));border:1px solid rgba(125,211,252,.18);border-radius:20px;color:#e0f2fe;line-height:1.7}}
.metrics{{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin-top:18px}} .metric,.hero-card{{padding:18px}} .metric strong{{display:block;margin-top:10px;font-size:30px;line-height:1}} .metric span,.meta,.section-subtitle{{color:var(--muted)}} .section-subtitle{{font-size:12px;text-transform:uppercase;letter-spacing:.14em}}
.progress-rail{{margin-top:16px;height:10px;border-radius:999px;background:rgba(255,255,255,.07);overflow:hidden}} .progress-rail i{{display:block;height:100%;background:linear-gradient(90deg, var(--accent), #22d3ee)}}
.checkpoint{{margin-top:20px;padding:22px;border-radius:24px;border:1px solid rgba(255,255,255,.08);background:linear-gradient(135deg, rgba(56,189,248,.14), rgba(251,191,36,.1))}} .checkpoint.test{{background:linear-gradient(135deg, rgba(96,165,250,.18), rgba(34,211,238,.08))}} .checkpoint.approval{{background:linear-gradient(135deg, rgba(251,191,36,.18), rgba(248,250,252,.06))}} .checkpoint.completed{{background:linear-gradient(135deg, rgba(52,211,153,.16), rgba(255,255,255,.05))}}
.checkpoint h2{{margin:10px 0 8px;font-size:26px;letter-spacing:-.03em}} .checkpoint p{{margin:0;color:#e2e8f0;line-height:1.75}} .checkpoint-meta{{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px}} .checkpoint-note{{margin-top:16px;color:#dbeafe;font-weight:600}}
.section{{overflow:hidden}} .section summary{{list-style:none;cursor:pointer;padding:20px 22px;display:flex;align-items:center;justify-content:space-between;gap:16px;font-size:18px;font-weight:700;letter-spacing:-.02em}} .section summary::-webkit-details-marker{{display:none}} .section-body{{padding:0 22px 22px}}
.board{{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}} .column{{padding:14px;border-radius:18px;background:rgba(6,12,24,.65);border:1px solid rgba(255,255,255,.06)}} .column h3{{margin:0 0 12px;font-size:12px;text-transform:uppercase;letter-spacing:.14em;color:#cbd5e1}}
.grid2{{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}} .task-card,.proposal-card,.record-card,.timeline-item{{padding:14px}} .task-card+.task-card,.proposal-card+.proposal-card,.record-card+.record-card{{margin-top:10px}}
.top{{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}} .top h4{{margin:0;font-size:15px;line-height:1.45}} .meta{{margin:8px 0 0;font-size:12px;line-height:1.6}} .timeline-item em{{display:block;margin-bottom:8px;font-style:normal;font-size:12px;font-weight:700;color:#bfdbfe}} .timeline-item h4{{margin:0 0 6px;font-size:15px}} .timeline-item p,.proposal-card p,.record-card p{{margin:0;color:var(--muted);line-height:1.7;font-size:14px}} .value{{margin-top:12px;color:#dbeafe;font-weight:700}}
.empty{{padding:20px;border-radius:18px;text-align:center;color:var(--muted);border:1px dashed rgba(255,255,255,.12);background:rgba(2,6,23,.38)}}
.badge{{padding:7px 10px;font-size:10px;text-transform:uppercase;letter-spacing:.1em;white-space:nowrap}} .backlog,.draft,.idle{{background:rgba(148,163,184,.14);color:#cbd5e1}} .in_progress,.sent,.feedback{{background:rgba(59,130,246,.18);color:#bfdbfe}} .review,.requested,.approval{{background:rgba(245,158,11,.18);color:#fde68a}} .done,.accepted,.completed,.test{{background:rgba(16,185,129,.18);color:#a7f3d0}} .viewed{{background:rgba(168,85,247,.18);color:#e9d5ff}} .rejected{{background:rgba(239,68,68,.18);color:#fecaca}}
footer{{margin-top:18px;text-align:center;color:rgba(148,163,184,.8);font-size:12px}}
@media (max-width:980px){{.hero-grid,.metrics,.board,.grid2{{grid-template-columns:repeat(2,minmax(0,1fr))}}}}
@media (max-width:760px){{.shell{{width:min(100%, calc(100% - 18px));padding-top:18px}}.hero{{padding:20px}}.hero-grid,.metrics,.board,.grid2{{grid-template-columns:1fr}}.section summary{{padding:18px;font-size:16px}}.section-body{{padding:0 18px 18px}}}}
"""


def _task_card_html(task: dict[str, Any]) -> str:
    created = _escape(_fmt(datetime.fromisoformat(task["created_at"])))
    parts = [
        "<article class='task-card'>",
        f"<div class='top'><h4>{_escape(task['title'])}</h4>{_badge(TASK_LABELS.get(task['status'], task['status']), task['status'])}</div>",
        f"<p class='meta'>Prioridade: {_escape(task['priority'])}</p>",
        f"<p class='meta'>Criada em {created}</p>",
    ]
    if task["completed_at"]:
        completed = _escape(_fmt(datetime.fromisoformat(task["completed_at"])))
        parts.append(f"<p class='meta'>Concluida em {completed}</p>")
    parts.append("</article>")
    return "".join(parts)


def _proposal_card_html(item: dict[str, Any]) -> str:
    created = _escape(_fmt(datetime.fromisoformat(item["created_at"])))
    value = _escape(item["total_value"] or "Valor nao informado")
    return (
        "<article class='proposal-card'>"
        f"<div class='top'><h4>{_escape(item['title'])}</h4>{_badge(PROPOSAL_LABELS.get(item['status'], item['status']), item['status'])}</div>"
        f"<p class='meta'>Criada em {created}</p><p class='value'>{value}</p></article>"
    )


def _recording_card_html(item: dict[str, Any]) -> str:
    recorded = _escape(_fmt(datetime.fromisoformat(item["recorded_at"])))
    summary = _escape(item["summary"] or "Resumo em preparacao.")
    duration = _escape(_duration(item["duration_seconds"]))
    return (
        "<article class='record-card'>"
        f"<div class='top'><h4>{_escape(item['title'])}</h4><span class='meta'>{recorded}</span></div>"
        f"<p>{summary}</p><p class='meta'>Duracao: {duration}</p></article>"
    )


def _timeline_html(item: dict[str, Any]) -> str:
    date = _escape(_fmt(datetime.fromisoformat(item["date"])))
    return f"<article class='timeline-item'><em>{date}</em><h4>{_escape(item['event'])}</h4><p>{_escape(item['description'])}</p></article>"


def _portal_html(payload: dict[str, Any]) -> str:
    feedback = payload["feedback"]
    summary = payload["summary"]
    status = PROJECT_LABELS.get(payload["project"]["status"], payload["project"]["status"])
    latest_update = _fmt(datetime.fromisoformat(summary["latest_update"])) if summary["latest_update"] else "Sem movimentacoes recentes"
    checkpoint_class = feedback["type"] if feedback["status"] == "requested" else feedback["status"]
    checkpoint_meta = [
        _badge(feedback["status_label"], feedback["status"]),
        _badge(feedback["eyebrow"], feedback["type"]),
    ]
    if feedback["requested_at"]:
        checkpoint_meta.append(
            f"<span class='pill'>Solicitado em {_escape(_fmt(datetime.fromisoformat(feedback['requested_at'])))}</span>"
        )

    sections = []
    if "tasks" in payload["visible_sections"]:
        columns = []
        for key, label in [("backlog", "Backlog"), ("in_progress", "Em andamento"), ("review", "Em revisao"), ("done", "Concluido")]:
            items = [task for task in payload["tasks"] if task["status"] == key or (key == "backlog" and task["status"] == "todo")]
            cards = "".join(_task_card_html(task) for task in items) or "<div class='empty'>Nenhuma tarefa nesta etapa.</div>"
            columns.append(f"<div class='column'><h3>{_escape(label)}</h3>{cards}</div>")
        sections.append(
            f"<details class='section' open><summary><div><div class='section-subtitle'>Execucao</div><span>Quadro de tarefas</span></div><span class='pill'>{summary['tasks_total']} itens</span></summary><div class='section-body board'>{''.join(columns)}</div></details>"
        )
    if "timeline" in payload["visible_sections"]:
        items = "".join(_timeline_html(item) for item in payload["timeline"]) or "<div class='empty'>Nenhuma atualizacao recente para mostrar.</div>"
        sections.append(
            f"<details class='section' open><summary><div><div class='section-subtitle'>Movimento</div><span>Timeline do projeto</span></div><span class='pill'>{summary['timeline_total']} eventos</span></summary><div class='section-body timeline'>{items}</div></details>"
        )
    if "proposals" in payload["visible_sections"]:
        items = "".join(_proposal_card_html(item) for item in payload["proposals"]) or "<div class='empty'>Nenhuma proposta vinculada a este projeto.</div>"
        sections.append(
            f"<details class='section' open><summary><div><div class='section-subtitle'>Comercial</div><span>Propostas e valores</span></div><span class='pill'>{summary['proposals_total']} registradas</span></summary><div class='section-body grid2'>{items}</div></details>"
        )
    if "recordings" in payload["visible_sections"]:
        items = "".join(_recording_card_html(item) for item in payload["recordings"]) or "<div class='empty'>Nenhuma gravacao compartilhada ate o momento.</div>"
        sections.append(
            f"<details class='section' open><summary><div><div class='section-subtitle'>Contexto</div><span>Gravacoes e resumos</span></div><span class='pill'>{summary['recordings_total']} resumos</span></summary><div class='section-body grid2'>{items}</div></details>"
        )
    if not sections:
        sections.append("<div class='empty'>Nenhuma secao foi liberada neste link.</div>")

    return (
        "<!DOCTYPE html><html lang='pt-BR'><head><meta charset='UTF-8'>"
        "<meta name='viewport' content='width=device-width, initial-scale=1.0'>"
        f"<title>Portal do Cliente - {_escape(payload['project']['name'])}</title><style>{_base_css(_safe_color(payload['project']['color']))}</style></head>"
        "<body><main class='shell'>"
        "<section class='hero panel'>"
        "<span class='eyebrow'>Orquestra Client Portal</span>"
        "<div class='hero-grid'><div>"
        f"<div style='display:flex;gap:10px;flex-wrap:wrap'><span class='pill pill-accent'>{_escape(status)}</span><span class='pill'>Cliente: {_escape(payload['client_name'])}</span></div>"
        f"<h1>{_escape(payload['project']['name'])}</h1>"
        f"<p class='lead'>{_escape(payload['project']['description'] or 'Um espaco central para acompanhar andamento, entregas e checkpoints do projeto.')}</p>"
        f"<div class='welcome'>{_escape(payload['welcome_message'])}</div>"
        "</div><div class='hero-stack'>"
        "<div class='hero-card'><div class='section-subtitle'>Progresso</div>"
        f"<strong style='display:block;font-size:42px;line-height:1;margin-top:8px'>{summary['progress_percent']}%</strong>"
        f"<p class='lead' style='font-size:14px;margin-top:10px'>{summary['tasks_done']} de {summary['tasks_total']} tarefas concluidas</p><div class='progress-rail'><i style='width:{summary['progress_percent']}%'></i></div></div>"
        "<div class='hero-card'><div class='section-subtitle'>Ultima movimentacao</div>"
        f"<p class='lead' style='font-size:14px;margin-top:10px'>{_escape(latest_update)}</p><p class='meta'>Este portal concentra tarefas, propostas, gravacoes e checkpoints para voce acompanhar sem vasculhar conversas antigas.</p></div>"
        "</div></div>"
        "<div class='metrics'>"
        f"<div class='metric'><span>Tarefas totais</span><strong>{summary['tasks_total']}</strong><span>{payload['task_counts']['review']} em revisao</span></div>"
        f"<div class='metric'><span>Timeline</span><strong>{summary['timeline_total']}</strong><span>movimentacoes recentes</span></div>"
        f"<div class='metric'><span>Propostas</span><strong>{summary['proposals_total']}</strong><span>itens comerciais</span></div>"
        f"<div class='metric'><span>Gravacoes</span><strong>{summary['recordings_total']}</strong><span>resumos disponiveis</span></div>"
        "</div>"
        f"<section class='checkpoint {checkpoint_class}'><div class='section-subtitle'>{_escape(feedback['eyebrow'])}</div><h2>{_escape(feedback['title'])}</h2><p>{_escape(feedback['message'])}</p><div class='checkpoint-meta'>{''.join(checkpoint_meta)}</div><div class='checkpoint-note'>{_escape(feedback['cta'])}</div></section>"
        "</section>"
        f"<section class='section-stack'>{''.join(sections)}</section>"
        f"<footer>Orquestra · Diego Vilson · Atualizado em {_escape(_fmt(datetime.now(timezone.utc)))}</footer>"
        "</main></body></html>"
    )


@router.post("/links", status_code=201)
async def create_link(
    req: CreateClientPortalLinkRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    project = (await db.execute(select(Project).where(Project.id == req.project_id))).scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Projeto nao encontrado")

    contact = None
    if req.contact_id:
        contact = await _get_contact(req.contact_id, db)

    link = ClientPortalLink(
        project_id=req.project_id,
        contact_id=req.contact_id,
        token=secrets.token_urlsafe(32),
        client_name=req.client_name.strip(),
        visible_sections=_normalize_sections(req.visible_sections),
        welcome_message=(req.welcome_message or _default_welcome_message(req.client_name, project.name)).strip(),
        expires_at=datetime.now(timezone.utc) + timedelta(hours=req.expires_hours) if req.expires_hours else None,
    )
    db.add(link)
    await db.flush()
    await db.refresh(link)
    link.project = project
    link.contact = contact
    return _serialize_link(link, request)


@router.post("/links/bulk-active", status_code=201)
async def bulk_create_active_links(
    req: BulkCreateClientPortalLinksRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    contacts = (await db.execute(select(Contact).order_by(Contact.updated_at.desc()))).scalars().all()
    active_projects = (
        await db.execute(
            select(Project)
            .where(Project.status == "active")
            .order_by(Project.updated_at.desc())
        )
    ).scalars().all()
    project_by_id = {project.id: project for project in active_projects}
    existing_links = (
        await db.execute(
            select(ClientPortalLink)
            .options(selectinload(ClientPortalLink.project), selectinload(ClientPortalLink.contact))
        )
    ).scalars().all()
    links_by_pair = {(link.project_id, link.contact_id): link for link in existing_links if link.contact_id is not None}
    links_by_name = {(link.project_id, (link.client_name or "").strip().lower()): link for link in existing_links}

    created = []
    updated = []
    skipped = []
    sections = _normalize_sections(req.visible_sections)
    expires_at = datetime.now(timezone.utc) + timedelta(hours=req.expires_hours) if req.expires_hours else None

    for contact in contacts:
        try:
            if not _is_client_contact(contact):
                continue

            project = _resolve_contact_project(contact, active_projects, project_by_id)
            if not project:
                skipped.append(
                    {
                        "contact_id": str(contact.id),
                        "client_name": contact.name or contact.push_name or contact.phone,
                        "reason": "Sem projeto ativo vinculado",
                    }
                )
                continue

            client_name = (contact.name or contact.push_name or contact.phone or "Cliente").strip()
            link = links_by_pair.get((project.id, contact.id)) or links_by_name.get((project.id, client_name.lower()))

            if link:
                changed = False
                if link.contact_id != contact.id:
                    link.contact_id = contact.id
                    changed = True
                if not link.is_active:
                    link.is_active = True
                    changed = True
                if not link.visible_sections:
                    link.visible_sections = sections
                    changed = True
                if req.replace_welcome_message or not link.welcome_message:
                    link.welcome_message = _default_welcome_message(client_name, project.name)
                    changed = True
                if link.expires_at is None and expires_at is not None:
                    link.expires_at = expires_at
                    changed = True
                link.project = project
                link.contact = contact
                if changed:
                    updated.append({"contact_id": str(contact.id), "client_name": client_name, "project_name": project.name})
                continue

            link = ClientPortalLink(
                project_id=project.id,
                contact_id=contact.id,
                token=secrets.token_urlsafe(32),
                client_name=client_name,
                visible_sections=sections,
                welcome_message=_default_welcome_message(client_name, project.name),
                expires_at=expires_at,
            )
            db.add(link)
            link.project = project
            link.contact = contact
            existing_links.append(link)
            links_by_pair[(project.id, contact.id)] = link
            links_by_name[(project.id, client_name.lower())] = link
            created.append({"contact_id": str(contact.id), "client_name": client_name, "project_name": project.name})
        except Exception as exc:
            logger.exception("[CLIENT_PORTAL] bulk sync failed for contact=%s", contact.id)
            skipped.append(
                {
                    "contact_id": str(contact.id),
                    "client_name": contact.name or contact.push_name or contact.phone,
                    "reason": f"Erro ao sincronizar: {exc}",
                }
            )

    await db.flush()
    return {
        "created_count": len(created),
        "updated_count": len(updated),
        "skipped_count": len(skipped),
        "created": created,
        "updated": updated,
        "skipped": skipped[:20],
    }


@router.get("/links")
async def list_links(request: Request, db: AsyncSession = Depends(get_db)):
    links = (
        await db.execute(
            select(ClientPortalLink)
            .options(selectinload(ClientPortalLink.project), selectinload(ClientPortalLink.contact))
            .order_by(ClientPortalLink.created_at.desc())
        )
    ).scalars().all()
    return [_serialize_link(link, request) for link in links]


@router.patch("/links/{link_id}")
async def update_link(
    link_id: UUID,
    req: UpdateClientPortalLinkRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    link = await _get_link(link_id, db)
    if not link:
        raise HTTPException(status_code=404, detail="Link nao encontrado")

    data = req.model_dump(exclude_unset=True)
    if "contact_id" in data:
        link.contact = await _get_contact(req.contact_id, db) if req.contact_id else None
        link.contact_id = req.contact_id
    if "client_name" in data and req.client_name:
        link.client_name = req.client_name.strip()
    if "visible_sections" in data:
        link.visible_sections = _normalize_sections(req.visible_sections)
    if "welcome_message" in data:
        link.welcome_message = req.welcome_message.strip() if req.welcome_message else None
    if "is_active" in data:
        link.is_active = bool(req.is_active)
    if "feedback_type" in data:
        link.feedback_type = _normalize_feedback_type(req.feedback_type)
    if "feedback_title" in data:
        link.feedback_title = req.feedback_title.strip() if req.feedback_title else None
    if "feedback_message" in data:
        link.feedback_message = req.feedback_message.strip() if req.feedback_message else None
    if "feedback_status" in data:
        feedback_status = _normalize_feedback_status(req.feedback_status)
        link.feedback_status = feedback_status
        if feedback_status == "requested" and not link.feedback_requested_at:
            link.feedback_requested_at = datetime.now(timezone.utc)
        if feedback_status == "completed":
            link.feedback_completed_at = datetime.now(timezone.utc)
        if feedback_status == "idle":
            link.feedback_completed_at = None
            link.feedback_requested_at = None
            link.feedback_sent_at = None

    await db.flush()
    return _serialize_link(link, request)


@router.post("/links/{link_id}/request-feedback")
async def request_feedback(
    link_id: UUID,
    req: RequestClientPortalFeedbackRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    link = await _get_link(link_id, db)
    if not link:
        raise HTTPException(status_code=404, detail="Link nao encontrado")
    if not link.contact or not link.contact.phone:
        raise HTTPException(status_code=400, detail="Este portal ainda nao esta vinculado a um contato com telefone")

    feedback_type = _normalize_feedback_type(req.feedback_type)
    title, message = _feedback_defaults(feedback_type, link.project.name if link.project else "seu projeto")
    link.feedback_type = feedback_type
    link.feedback_status = "requested"
    link.feedback_title = (req.title or title).strip()
    link.feedback_message = (req.message or message).strip()
    link.feedback_requested_at = datetime.now(timezone.utc)
    link.feedback_completed_at = None

    portal_url = f"{_portal_base_url(request)}/api/client-portal/portal/{link.token}"
    notification_sent = False
    if req.send_whatsapp:
        notification_sent = await send_whatsapp_message(
            link.contact.phone,
            _build_feedback_notification(link, portal_url),
        )
        if notification_sent:
            link.feedback_sent_at = datetime.now(timezone.utc)

    await db.flush()
    payload = _serialize_link(link, request)
    payload["notification_sent"] = notification_sent
    return payload


@router.delete("/links/{link_id}", status_code=204)
async def delete_link(link_id: UUID, db: AsyncSession = Depends(get_db)):
    link = (await db.execute(select(ClientPortalLink).where(ClientPortalLink.id == link_id))).scalar_one_or_none()
    if not link:
        raise HTTPException(status_code=404, detail="Link nao encontrado")
    link.is_active = False
    await db.flush()
    return Response(status_code=204)


@router.get("/portal/{token}", response_class=HTMLResponse)
async def portal_page(token: str, db: AsyncSession = Depends(get_db)):
    link = await _get_link_by_token(token, db)
    valid, status_code, title, message = _validate_public_link(link)
    if not valid:
        return HTMLResponse(content=_error_html(title, message), status_code=status_code)

    assert link is not None
    link.view_count = (link.view_count or 0) + 1
    link.last_viewed_at = datetime.now(timezone.utc)
    await db.flush()
    logger.info("[CLIENT_PORTAL] view token=%s project=%s count=%s", token[:8], link.project_id, link.view_count)
    return HTMLResponse(content=_portal_html(await _build_payload(link, db)))


@router.get("/portal/{token}/data")
async def portal_data(token: str, db: AsyncSession = Depends(get_db)):
    link = await _get_link_by_token(token, db)
    valid, status_code, _, message = _validate_public_link(link)
    if not valid:
        raise HTTPException(status_code=status_code, detail=message)
    assert link is not None
    return await _build_payload(link, db)
