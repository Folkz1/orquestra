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

logger = logging.getLogger(__name__)
router = APIRouter()

DEFAULT_SECTIONS = ["tasks", "timeline", "proposals", "recordings"]
ALLOWED_SECTIONS = set(DEFAULT_SECTIONS)
TASK_LABELS = {
    "backlog": "Backlog",
    "todo": "Backlog",
    "in_progress": "Em progresso",
    "review": "Em revisão",
    "done": "Concluído",
}
PROPOSAL_LABELS = {
    "draft": "Rascunho",
    "sent": "Enviada",
    "viewed": "Visualizada",
    "accepted": "Aceita",
    "rejected": "Recusada",
}
PROJECT_LABELS = {"active": "Ativo", "paused": "Pausado", "archived": "Arquivado"}


class CreateClientPortalLinkRequest(BaseModel):
    project_id: UUID
    client_name: str = Field(..., min_length=1, max_length=255)
    visible_sections: Optional[list[str]] = None
    welcome_message: Optional[str] = Field(None, max_length=3000)
    expires_hours: Optional[int] = Field(168, ge=1, le=8760)


class UpdateClientPortalLinkRequest(BaseModel):
    visible_sections: Optional[list[str]] = None
    welcome_message: Optional[str] = Field(None, max_length=3000)
    is_active: Optional[bool] = None


def _normalize_sections(sections: Optional[list[str]]) -> list[str]:
    if not sections:
        return list(DEFAULT_SECTIONS)
    output = []
    for section in sections:
        key = (section or "").strip().lower()
        if key in ALLOWED_SECTIONS and key not in output:
            output.append(key)
    return output or list(DEFAULT_SECTIONS)


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
    return value.astimezone(timezone.utc).strftime("%d/%m/%Y às %H:%M UTC")


def _iso(value: Optional[datetime]) -> Optional[str]:
    return value.isoformat() if value else None


def _escape(value: Any) -> str:
    return html.escape(str(value or ""))


def _duration(seconds: Any) -> str:
    if not seconds:
        return "Não informado"
    minutes, remaining = divmod(int(seconds), 60)
    return f"{minutes}min {remaining}s" if minutes else f"{remaining}s"


def _badge(text: str, tone: str) -> str:
    return f'<span class="badge {tone}">{_escape(text)}</span>'


async def _get_link(token: str, db: AsyncSession) -> ClientPortalLink | None:
    result = await db.execute(
        select(ClientPortalLink)
        .options(selectinload(ClientPortalLink.project))
        .where(ClientPortalLink.token == token)
    )
    return result.scalar_one_or_none()


def _validate_public_link(link: ClientPortalLink | None) -> tuple[bool, int, str, str]:
    if not link:
        return False, 404, "Link não encontrado", "Este link do portal do cliente não existe ou foi removido."
    if not link.is_active:
        return False, 410, "Link desativado", "Este link foi desativado. Solicite um novo acesso ao Diego."
    if link.expires_at and link.expires_at < datetime.now(timezone.utc):
        return False, 410, "Link expirado", "Este link expirou. Solicite um novo acesso ao Diego."
    return True, 200, "", ""


async def _build_payload(link: ClientPortalLink, db: AsyncSession) -> dict[str, Any]:
    sections = _normalize_sections(link.visible_sections)

    tasks = (
        await db.execute(
            select(ProjectTask)
            .where(ProjectTask.project_id == link.project_id)
            .order_by(ProjectTask.created_at.desc())
        )
    ).scalars().all()
    proposals = (
        await db.execute(
            select(Proposal)
            .join(Contact, Proposal.contact_id == Contact.id)
            .where(Contact.project_id == link.project_id)
            .order_by(Proposal.created_at.desc())
        )
    ).scalars().all()
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
            "title": recording.title or "Gravação sem título",
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
                    "description": f"{task.title} agora está em {TASK_LABELS.get(task.status, task.status).lower()}.",
                }
            )
        if task.completed_at:
            timeline.append(
                {
                    "sort": task.completed_at,
                    "date": _iso(task.completed_at),
                    "event": "Tarefa concluída",
                    "description": f"{task.title} foi concluída.",
                }
            )
    for recording in recordings:
        timeline.append(
            {
                "sort": recording.recorded_at,
                "date": _iso(recording.recorded_at),
                "event": "Nova gravação",
                "description": f"{recording.title or 'Gravação sem título'} foi adicionada ao projeto.",
            }
        )
    for proposal in proposals:
        timeline.append(
            {
                "sort": proposal.created_at,
                "date": _iso(proposal.created_at),
                "event": "Proposta enviada" if proposal.status in {"sent", "viewed", "accepted"} else "Proposta criada",
                "description": f"{proposal.title} foi registrada para acompanhamento.",
            }
        )
        if proposal.viewed_at:
            timeline.append(
                {
                    "sort": proposal.viewed_at,
                    "date": _iso(proposal.viewed_at),
                    "event": "Proposta visualizada",
                    "description": f"{proposal.title} foi visualizada pelo cliente.",
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

    project = link.project
    return {
        "project": {
            "name": project.name if project else "Projeto",
            "description": project.description if project else None,
            "status": project.status if project else "active",
            "color": _safe_color(project.color if project else None),
        },
        "client_name": link.client_name,
        "welcome_message": link.welcome_message or "Acompanhe aqui a evolução do seu projeto.",
        "visible_sections": sections,
        "tasks": tasks_data if "tasks" in sections else [],
        "timeline": [
            {"date": item["date"], "event": item["event"], "description": item["description"]}
            for item in sorted(
                timeline,
                key=lambda item: item["sort"] or datetime.min.replace(tzinfo=timezone.utc),
                reverse=True,
            )[:20]
        ] if "timeline" in sections else [],
        "proposals": proposals_data if "proposals" in sections else [],
        "recordings": recordings_data if "recordings" in sections else [],
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }


def _error_html(title: str, message: str) -> str:
    return (
        "<!DOCTYPE html><html lang='pt-BR'><head><meta charset='UTF-8'>"
        "<meta name='viewport' content='width=device-width, initial-scale=1.0'>"
        f"<title>{_escape(title)} - Orquestra</title><style>{_base_css('#38bdf8')}</style></head>"
        f"<body><main class='shell'><section class='hero'><span class='eyebrow'>Portal do Cliente</span><h1>{_escape(title)}</h1><p class='subtitle'>{_escape(message)}</p></section></main></body></html>"
    )


def _base_css(accent: str) -> str:
    return """
*{box-sizing:border-box}
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#e2e8f0;background:
radial-gradient(circle at top right,rgba(56,189,248,.22),transparent 24%),
radial-gradient(circle at bottom left,rgba(14,165,233,.18),transparent 20%),
linear-gradient(135deg,#0f172a,#1e293b);min-height:100vh}
.shell{width:min(1100px,calc(100% - 24px));margin:0 auto;padding:22px 0 40px}
.hero,.section{background:rgba(30,41,59,.86);border:1px solid rgba(148,163,184,.18);border-radius:24px;box-shadow:0 28px 80px rgba(2,6,23,.42);backdrop-filter:blur(18px)}
.hero{padding:26px}
.eyebrow{display:inline-flex;padding:8px 12px;border-radius:999px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;background:rgba(15,23,42,.72);color:#bfdbfe;border:1px solid rgba(255,255,255,.08)}
h1{margin:16px 0 10px;font-size:clamp(32px,5vw,48px);line-height:1.02;letter-spacing:-.04em}
.subtitle,.muted{color:#94a3b8;line-height:1.7}
.hero-top{display:flex;justify-content:space-between;gap:18px;align-items:flex-start}
.pill{display:inline-flex;justify-content:center;align-items:center;padding:10px 14px;border-radius:999px;background:linear-gradient(135deg,rgba(56,189,248,.28),rgba(14,165,233,.08));border:1px solid rgba(125,211,252,.28);font-size:13px;font-weight:700}
.client-pill{margin-top:10px;background:rgba(15,23,42,.72);border:1px solid rgba(255,255,255,.08)}
.welcome,.stat,.card,.timeline-item,.task-card{background:rgba(15,23,42,.72);border:1px solid rgba(255,255,255,.08);border-radius:18px}
.welcome{margin-top:22px;padding:18px;color:#dbeafe}
.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin-top:22px}
.stat{padding:18px}
.stat strong{display:block;font-size:29px;line-height:1.1;margin-top:10px}
.stack{display:grid;gap:18px;margin-top:22px}
.section summary{list-style:none;cursor:pointer;padding:20px 22px;display:flex;justify-content:space-between;align-items:center;font-size:18px;font-weight:700;border-bottom:1px solid rgba(255,255,255,.06)}
.section summary::-webkit-details-marker{display:none}
.section-body{padding:22px}
.kanban{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}
.column{padding:14px;background:rgba(15,23,42,.62);border:1px solid rgba(255,255,255,.06);border-radius:18px}
.column h3{margin:0 0 12px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#cbd5e1}
.task-card,.card{padding:14px;margin-bottom:10px}
.task-card:last-child,.card:last-child{margin-bottom:0}
.top{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}
.top h4{margin:0;font-size:15px;line-height:1.4}
.meta{margin:8px 0 0;color:#94a3b8;font-size:12px;line-height:1.5}
.grid2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
.timeline{display:grid;gap:14px}
.timeline-item{padding:14px 16px}
.timeline-item em{display:block;color:#93c5fd;font-style:normal;font-size:12px;font-weight:700;margin-bottom:8px}
.timeline-item h4{margin:0 0 6px;font-size:15px}
.timeline-item p,.card p{margin:0;color:#94a3b8;line-height:1.65;font-size:14px}
.value{margin-top:12px;color:#bfdbfe;font-weight:700}
.badge{display:inline-flex;padding:6px 10px;border-radius:999px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;white-space:nowrap}
.backlog,.draft{background:rgba(148,163,184,.14);color:#cbd5e1}
.in_progress,.sent{background:rgba(59,130,246,.18);color:#93c5fd}
.review{background:rgba(245,158,11,.18);color:#fcd34d}
.done,.accepted{background:rgba(16,185,129,.18);color:#86efac}
.viewed{background:rgba(168,85,247,.18);color:#d8b4fe}
.rejected{background:rgba(239,68,68,.18);color:#fca5a5}
.empty{padding:18px;text-align:center;color:#94a3b8;border:1px dashed rgba(255,255,255,.12);border-radius:16px;background:rgba(15,23,42,.56)}
footer{margin-top:18px;text-align:center;color:rgba(148,163,184,.78);font-size:12px}
@media (max-width:920px){.stats,.kanban,.grid2{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:720px){.shell{width:min(100%,calc(100% - 16px));padding-top:16px}.hero{padding:20px}.hero-top{flex-direction:column}.stats,.kanban,.grid2{grid-template-columns:1fr}.section summary{padding:18px;font-size:16px}.section-body{padding:18px}}
""".replace("__ACCENT__", accent)


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
        parts.append(f"<p class='meta'>Concluída em {completed}</p>")
    parts.append("</article>")
    return "".join(parts)


def _proposal_card_html(item: dict[str, Any]) -> str:
    created = _escape(_fmt(datetime.fromisoformat(item["created_at"])))
    value = _escape(item["total_value"] or "Valor não informado")
    return (
        "<article class='card'>"
        f"<div class='top'><h4>{_escape(item['title'])}</h4>{_badge(PROPOSAL_LABELS.get(item['status'], item['status']), item['status'])}</div>"
        f"<p class='meta'>Criada em {created}</p><p class='value'>{value}</p></article>"
    )


def _recording_card_html(item: dict[str, Any]) -> str:
    recorded = _escape(_fmt(datetime.fromisoformat(item["recorded_at"])))
    summary = _escape(item["summary"] or "Resumo em preparação.")
    duration = _escape(_duration(item["duration_seconds"]))
    return (
        "<article class='card'>"
        f"<div class='top'><h4>{_escape(item['title'])}</h4><span class='muted'>{recorded}</span></div>"
        f"<p>{summary}</p><p class='meta'>Duração: {duration}</p></article>"
    )


def _timeline_html(item: dict[str, Any]) -> str:
    date = _escape(_fmt(datetime.fromisoformat(item["date"])))
    return f"<article class='timeline-item'><em>{date}</em><h4>{_escape(item['event'])}</h4><p>{_escape(item['description'])}</p></article>"


def _portal_html(payload: dict[str, Any]) -> str:
    accent = _safe_color(payload["project"]["color"])
    counts = {
        "tasks": len(payload["tasks"]),
        "timeline": len(payload["timeline"]),
        "proposals": len(payload["proposals"]),
        "recordings": len(payload["recordings"]),
    }
    done_count = sum(1 for task in payload["tasks"] if task["status"] == "done")
    status = PROJECT_LABELS.get(payload["project"]["status"], payload["project"]["status"])
    sections = []

    if "tasks" in payload["visible_sections"]:
        columns = []
        for key, label in [("backlog", "Backlog"), ("in_progress", "Em progresso"), ("review", "Em revisão"), ("done", "Concluído")]:
            items = [task for task in payload["tasks"] if task["status"] == key]
            cards = "".join(_task_card_html(task) for task in items) or "<div class='empty'>Nenhuma tarefa nesta etapa.</div>"
            columns.append(f"<div class='column'><h3>{_escape(label)}</h3>{cards}</div>")
        sections.append(
            f"<details class='section' open><summary><span>📋 Tasks</span><span class='muted'>{counts['tasks']} itens</span></summary><div class='section-body kanban'>{''.join(columns)}</div></details>"
        )

    if "timeline" in payload["visible_sections"]:
        items = "".join(_timeline_html(item) for item in payload["timeline"]) or "<div class='empty'>Nenhuma atualização recente para mostrar.</div>"
        sections.append(
            f"<details class='section' open><summary><span>🗓 Timeline</span><span class='muted'>{counts['timeline']} eventos</span></summary><div class='section-body timeline'>{items}</div></details>"
        )

    if "proposals" in payload["visible_sections"]:
        items = "".join(_proposal_card_html(item) for item in payload["proposals"]) or "<div class='empty'>Nenhuma proposta vinculada a este projeto.</div>"
        sections.append(
            f"<details class='section' open><summary><span>📄 Propostas</span><span class='muted'>{counts['proposals']} vinculadas</span></summary><div class='section-body grid2'>{items}</div></details>"
        )

    if "recordings" in payload["visible_sections"]:
        items = "".join(_recording_card_html(item) for item in payload["recordings"]) or "<div class='empty'>Nenhuma gravação compartilhada até o momento.</div>"
        sections.append(
            f"<details class='section' open><summary><span>🎙️ Gravações</span><span class='muted'>{counts['recordings']} resumos</span></summary><div class='section-body grid2'>{items}</div></details>"
        )

    if not sections:
        sections.append("<div class='empty'>Nenhuma seção foi liberada neste link.</div>")

    return (
        "<!DOCTYPE html><html lang='pt-BR'><head><meta charset='UTF-8'>"
        "<meta name='viewport' content='width=device-width, initial-scale=1.0'>"
        f"<title>Portal do Cliente - {_escape(payload['project']['name'])}</title><style>{_base_css(accent)}</style></head>"
        "<body><main class='shell'>"
        "<section class='hero'>"
        "<div class='hero-top'><div>"
        "<span class='eyebrow'>Portal do Cliente</span>"
        f"<h1>{_escape(payload['project']['name'])}</h1>"
        f"<p class='subtitle'>{_escape(payload['project']['description'] or 'Um espaço central para acompanhar o andamento do projeto em tempo real.')}</p>"
        f"</div><div><div class='pill'>{_escape(status)}</div><div class='pill client-pill'>Cliente: {_escape(payload['client_name'])}</div></div></div>"
        f"<div class='welcome'>{_escape(payload['welcome_message'])}</div>"
        "<div class='stats'>"
        f"<div class='stat'><span class='muted'>Tarefas</span><strong>{counts['tasks']}</strong><span class='muted'>{done_count} concluídas</span></div>"
        f"<div class='stat'><span class='muted'>Timeline</span><strong>{counts['timeline']}</strong><span class='muted'>últimas movimentações</span></div>"
        f"<div class='stat'><span class='muted'>Propostas</span><strong>{counts['proposals']}</strong><span class='muted'>itens vinculados</span></div>"
        f"<div class='stat'><span class='muted'>Gravações</span><strong>{counts['recordings']}</strong><span class='muted'>resumos disponíveis</span></div>"
        "</div></section>"
        f"<section class='stack'>{''.join(sections)}</section>"
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
        raise HTTPException(status_code=404, detail="Projeto não encontrado")

    link = ClientPortalLink(
        project_id=req.project_id,
        token=secrets.token_urlsafe(32),
        client_name=req.client_name.strip(),
        visible_sections=_normalize_sections(req.visible_sections),
        welcome_message=req.welcome_message.strip() if req.welcome_message else None,
        expires_at=datetime.now(timezone.utc) + timedelta(hours=req.expires_hours) if req.expires_hours else None,
    )
    db.add(link)
    await db.flush()

    return {
        "id": str(link.id),
        "portal_url": f"{_portal_base_url(request)}/api/client-portal/portal/{link.token}",
        "token": link.token,
        "project_id": str(req.project_id),
        "project_name": project.name,
        "client_name": link.client_name,
        "visible_sections": link.visible_sections,
        "welcome_message": link.welcome_message,
        "is_active": link.is_active,
        "view_count": link.view_count,
        "last_viewed_at": _iso(link.last_viewed_at),
        "expires_at": _iso(link.expires_at),
        "created_at": _iso(link.created_at),
    }


@router.get("/links")
async def list_links(request: Request, db: AsyncSession = Depends(get_db)):
    links = (
        await db.execute(
            select(ClientPortalLink)
            .options(selectinload(ClientPortalLink.project))
            .order_by(ClientPortalLink.created_at.desc())
        )
    ).scalars().all()
    base_url = _portal_base_url(request)
    return [
        {
            "id": str(link.id),
            "project_id": str(link.project_id),
            "project_name": link.project.name if link.project else None,
            "project_status": link.project.status if link.project else None,
            "project_color": link.project.color if link.project else None,
            "client_name": link.client_name,
            "portal_url": f"{base_url}/api/client-portal/portal/{link.token}",
            "visible_sections": _normalize_sections(link.visible_sections),
            "welcome_message": link.welcome_message,
            "is_active": link.is_active,
            "view_count": link.view_count or 0,
            "last_viewed_at": _iso(link.last_viewed_at),
            "expires_at": _iso(link.expires_at),
            "created_at": _iso(link.created_at),
        }
        for link in links
    ]


@router.patch("/links/{link_id}")
async def update_link(
    link_id: UUID,
    req: UpdateClientPortalLinkRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    link = (
        await db.execute(
            select(ClientPortalLink)
            .options(selectinload(ClientPortalLink.project))
            .where(ClientPortalLink.id == link_id)
        )
    ).scalar_one_or_none()
    if not link:
        raise HTTPException(status_code=404, detail="Link não encontrado")

    data = req.model_dump(exclude_unset=True)
    if "visible_sections" in data:
        link.visible_sections = _normalize_sections(req.visible_sections)
    if "welcome_message" in data:
        link.welcome_message = req.welcome_message.strip() if req.welcome_message else None
    if "is_active" in data:
        link.is_active = bool(req.is_active)

    await db.flush()
    return {
        "id": str(link.id),
        "project_id": str(link.project_id),
        "project_name": link.project.name if link.project else None,
        "client_name": link.client_name,
        "portal_url": f"{_portal_base_url(request)}/api/client-portal/portal/{link.token}",
        "visible_sections": _normalize_sections(link.visible_sections),
        "welcome_message": link.welcome_message,
        "is_active": link.is_active,
        "view_count": link.view_count or 0,
        "last_viewed_at": _iso(link.last_viewed_at),
        "expires_at": _iso(link.expires_at),
        "created_at": _iso(link.created_at),
    }


@router.delete("/links/{link_id}", status_code=204)
async def delete_link(link_id: UUID, db: AsyncSession = Depends(get_db)):
    link = (await db.execute(select(ClientPortalLink).where(ClientPortalLink.id == link_id))).scalar_one_or_none()
    if not link:
        raise HTTPException(status_code=404, detail="Link não encontrado")
    link.is_active = False
    await db.flush()
    return Response(status_code=204)


@router.get("/portal/{token}", response_class=HTMLResponse)
async def portal_page(token: str, db: AsyncSession = Depends(get_db)):
    link = await _get_link(token, db)
    valid, status_code, title, message = _validate_public_link(link)
    if not valid:
        return HTMLResponse(content=_error_html(title, message), status_code=status_code)

    assert link is not None
    link.view_count = (link.view_count or 0) + 1
    link.last_viewed_at = datetime.now(timezone.utc)
    logger.info("[CLIENT_PORTAL] view token=%s project=%s count=%s", token[:8], link.project_id, link.view_count)
    return HTMLResponse(content=_portal_html(await _build_payload(link, db)))


@router.get("/portal/{token}/data")
async def portal_data(token: str, db: AsyncSession = Depends(get_db)):
    link = await _get_link(token, db)
    valid, status_code, _, message = _validate_public_link(link)
    if not valid:
        raise HTTPException(status_code=status_code, detail=message)
    assert link is not None
    return await _build_payload(link, db)
