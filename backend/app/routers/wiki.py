"""
Wiki router — LLM Wiki da Orquestra (padrao Karpathy).

A logica de geracao esta embutida aqui — sem dependencia de script externo.
Os arquivos .md sao salvos em /app/storage/wiki/ (volume Docker).

POST /api/wiki/rebuild  → regenera wiki em background (WIKI_SECRET_KEY)
GET  /api/wiki/graph    → nodes + edges para o grafo visual (APP_SECRET_KEY)
GET  /api/wiki/status   → log das ultimas geracoes (WIKI_SECRET_KEY)
"""

import re
import json
import logging
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.config import settings

logger = logging.getLogger(__name__)
router = APIRouter()
_bearer = HTTPBearer(auto_error=False)

# Diretorio base da wiki — dentro do volume Docker
WIKI_DIR = Path("/app/storage/wiki")

API_BASE = "https://orquestra-backend.jz9bd8.easypanel.host"
API_TOKEN = settings.APP_SECRET_KEY or "orquestra-secret-key-2026"


# ─── Auth ─────────────────────────────────────────────────────────────────────

def _require_wiki_key(
    credentials: HTTPAuthorizationCredentials | None = Security(_bearer),
):
    expected = settings.WIKI_SECRET_KEY
    if not expected:
        raise HTTPException(status_code=503, detail="WIKI_SECRET_KEY nao configurada")
    token = credentials.credentials if credentials else None
    if not token or token != expected:
        raise HTTPException(status_code=403, detail="Token invalido para /api/wiki")


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _fetch(path: str) -> dict | list:
    req = urllib.request.Request(
        f"{API_BASE}{path}",
        headers={"Authorization": f"Bearer {API_TOKEN}"},
    )
    return json.loads(urllib.request.urlopen(req, timeout=30).read().decode("utf-8"))


def _slug(name: str) -> str:
    name = re.sub(r"[^\w\s-]", "", name.lower())
    return re.sub(r"[\s_]+", "-", name).strip("-") or "sem-nome"


def _wikilink(name: str) -> str:
    return f"[[{name}]]"


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")


def _fmt_date(iso: str | None) -> str:
    if not iso:
        return "?"
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
        return dt.strftime("%d/%m/%Y")
    except Exception:
        return iso[:10]


def _write(path: Path, content: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    logger.info("wiki: wrote %s", path.relative_to(WIKI_DIR))


# ─── Geradores ────────────────────────────────────────────────────────────────

def _fetch_messages(contact_id: str, limit: int = 30) -> list[dict]:
    """Busca ultimas mensagens WhatsApp de um contato."""
    try:
        raw = _fetch(f"/api/messages?contact_id={contact_id}&limit={limit}")
        msgs = raw if isinstance(raw, list) else raw.get("items", raw.get("messages", raw.get("data", [])))
        return msgs or []
    except Exception as e:
        logger.warning("wiki: erro ao buscar msgs do contato %s: %s", contact_id, e)
        return []


def _build_contacts(contacts, recordings, projects) -> list[str]:
    names = []
    contact_names = [c.get("name", "") for c in contacts if c.get("name")]

    def recs_for(name):
        nl = name.lower()
        return [r for r in recordings if nl in (r.get("title") or "").lower() or nl in (r.get("summary") or "").lower()]

    for c in contacts:
        name = c.get("name") or "Sem Nome"
        if name.startswith("_DELETAR"):
            continue
        phone      = c.get("phone") or "?"
        created    = _fmt_date(c.get("created_at"))
        tags       = c.get("tags") or []
        notes      = c.get("notes") or ""
        contact_id = c.get("id") or ""

        related_projects   = [p.get("name") for p in projects if name.lower() in (p.get("name") or "").lower()]
        related_recordings = recs_for(name)

        lines = [
            f"# {name}", "",
            f"> Contato WhatsApp | Adicionado em {created}", "",
            "## Dados",
            f"- **Telefone:** `{phone}`",
            f"- **Tags:** {', '.join(tags) if tags else 'nenhuma'}",
        ]
        if notes:
            lines += ["", "## Notas", notes]
        if related_projects:
            lines += ["", "## Projetos Relacionados"]
            for p in related_projects:
                lines.append(f"- {_wikilink(p)}")
        if related_recordings:
            lines += ["", "## Calls e Gravacoes"]
            for r in related_recordings[:10]:
                title = r.get("title") or "?"
                date  = _fmt_date(r.get("recorded_at") or r.get("created_at"))
                lines.append(f"- {_wikilink(title)} — {date}")
                for d in (r.get("decisions") or [])[:2]:
                    lines.append(f"  - Decisao: {d}")
                for a in (r.get("action_items") or [])[:2]:
                    lines.append(f"  - Action: {a}")

        # Mensagens WhatsApp
        if contact_id:
            messages = _fetch_messages(contact_id, limit=30)
            text_msgs = [
                m for m in messages
                if (m.get("content") or m.get("transcription")) and m.get("message_type") in ("text", "audio", None, "")
            ]
            if text_msgs:
                lines += ["", "## Conversas WhatsApp (ultimas 30)"]
                for m in text_msgs[:30]:
                    direction = "→" if m.get("direction") == "outbound" else "←"
                    ts = _fmt_date(m.get("timestamp") or m.get("created_at"))
                    content = m.get("content") or m.get("transcription") or ""
                    content = content.strip().replace("\n", " ")[:200]
                    if content:
                        lines.append(f"- `{ts}` {direction} {content}")

        summary = c.get("last_message") or c.get("summary") or ""
        if summary:
            lines += ["", "## Ultimo Contato", f"> {summary[:300]}"]
        lines += ["", "---", f"*Atualizado em {_now()} pelo wiki da Orquestra*"]

        _write(WIKI_DIR / "contacts" / f"{_slug(name)}.md", "\n".join(lines))
        names.append(name)
    return names


def _build_recordings(recordings, contacts) -> list[str]:
    titles = []
    contact_names = [c.get("name", "") for c in contacts if c.get("name")]

    def find_contacts(text):
        tl = (text or "").lower()
        return [n for n in contact_names if n.lower() in tl]

    for r in recordings:
        title        = r.get("title") or "Sem titulo"
        date         = _fmt_date(r.get("recorded_at") or r.get("created_at"))
        duration     = r.get("duration_seconds") or 0
        summary      = r.get("summary") or ""
        transcription = r.get("transcription") or ""
        decisions    = r.get("decisions") or []
        actions      = r.get("action_items") or []
        topics       = r.get("key_topics") or []
        project_name = r.get("project_name") or ""
        mentioned    = find_contacts(title + " " + summary)
        dur_str      = f"{duration//60}m{duration%60:02d}s" if duration else "?"

        lines = [f"# {title}", "", f"> Gravacao de {date} | Duracao: {dur_str}", ""]
        if project_name:
            lines += [f"**Projeto:** {_wikilink(project_name)}", ""]
        if mentioned:
            lines += ["**Participantes:**"]
            for m in dict.fromkeys(mentioned):
                lines.append(f"- {_wikilink(m)}")
            lines.append("")
        if topics:
            lines += ["## Topicos", ", ".join(f"`{t}`" for t in topics), ""]
        if summary:
            lines += ["## Resumo", summary[:1000], ""]
        if isinstance(decisions, list) and decisions:
            lines += ["## Decisoes"]
            for d in decisions:
                lines.append(f"- {d}")
            lines.append("")
        if isinstance(actions, list) and actions:
            lines += ["## Action Items"]
            for a in actions:
                lines.append(f"- [ ] {a}")
            lines.append("")
        if transcription:
            preview = transcription[:2000]
            if len(transcription) > 2000:
                preview += f"\n\n*... (+{len(transcription)-2000} chars)*"
            lines += ["## Transcricao (preview)", "```", preview, "```", ""]
        lines += ["---", f"*Atualizado em {_now()} pelo wiki da Orquestra*"]

        _write(WIKI_DIR / "recordings" / f"{_slug(title)}.md", "\n".join(lines))
        titles.append(title)
    return titles


def _build_projects(projects, contacts, recordings) -> list[str]:
    names = []
    contact_names = [c.get("name", "") for c in contacts if c.get("name")]

    def find_contacts(text):
        tl = (text or "").lower()
        return [n for n in contact_names if n.lower() in tl]

    def recs_for(pname):
        nl = pname.lower()
        return [r for r in recordings if nl in (r.get("title") or "").lower()
                or nl in (r.get("project_name") or "").lower()]

    seen = set()
    for p in projects:
        name = p.get("name") or "Sem Nome"
        if name in seen:
            continue
        seen.add(name)

        status      = p.get("status") or "?"
        description = p.get("description") or ""
        created     = _fmt_date(p.get("created_at"))
        stack       = p.get("stack") or p.get("tech_stack") or ""
        mentioned   = find_contacts(name + " " + description)
        related_recs = recs_for(name)

        lines = [f"# {name}", "", f"> Projeto | Status: `{status}` | Criado em: {created}", ""]
        if description:
            lines += ["## Descricao", description, ""]
        if stack:
            lines += ["## Stack", f"`{stack}`", ""]
        if mentioned:
            lines += ["## Contatos Relacionados"]
            for c in mentioned:
                lines.append(f"- {_wikilink(c)}")
            lines.append("")
        if related_recs:
            lines += ["## Calls e Gravacoes"]
            for r in related_recs[:8]:
                t    = r.get("title") or "?"
                date = _fmt_date(r.get("recorded_at") or r.get("created_at"))
                lines.append(f"- {_wikilink(t)} — {date}")
            lines.append("")
        lines += ["---", f"*Atualizado em {_now()} pelo wiki da Orquestra*"]

        _write(WIKI_DIR / "projects" / f"{_slug(name)}.md", "\n".join(lines))
        names.append(name)
    return names


def _build_index(contact_names, recording_titles, project_names):
    today = datetime.now().strftime("%d/%m/%Y")
    lines = [
        "# Wiki da Orquestra", "",
        f"> Base de conhecimento gerada automaticamente. Atualizado em {today}.", "",
        f"## Projetos Ativos ({len(project_names)})",
    ]
    for n in sorted(project_names):
        lines.append(f"- {_wikilink(n)}")
    lines += ["", f"## Contatos ({len(contact_names)})"]
    for n in sorted(contact_names):
        lines.append(f"- {_wikilink(n)}")
    lines += ["", f"## Gravacoes ({len(recording_titles)})"]
    for t in sorted(recording_titles):
        lines.append(f"- {_wikilink(t)}")
    lines += ["", "---", f"*Gerado em {_now()} | Fonte: API Orquestra*"]
    _write(WIKI_DIR / "index.md", "\n".join(lines))


def _append_log(n_contacts, n_recordings, n_projects):
    entry = f"- **{_now()}** — {n_contacts} contatos, {n_recordings} gravacoes, {n_projects} projetos\n"
    log_path = WIKI_DIR / "log.md"
    if log_path.exists():
        log_path.write_text(log_path.read_text(encoding="utf-8") + entry, encoding="utf-8")
    else:
        _write(log_path, f"# Log de Geracoes\n{entry}")


# ─── Funcao principal de geracao ──────────────────────────────────────────────

def _generate_wiki(only: str | None = None):
    logger.info("wiki: iniciando geracao (only=%s)", only)

    # Buscar dados
    contacts_raw = _fetch("/api/contacts?limit=200")
    contacts = contacts_raw if isinstance(contacts_raw, list) else contacts_raw.get("data", contacts_raw.get("items", []))
    contacts = [c for c in contacts if not (c.get("name") or "").startswith("_DELETAR")]

    recordings = []
    page = 1
    while True:
        raw = _fetch(f"/api/recordings?per_page=100&page={page}")
        chunk = raw if isinstance(raw, list) else raw.get("items", raw.get("data", []))
        if not chunk:
            break
        recordings.extend(chunk)
        total_pages = raw.get("total_pages", 1) if isinstance(raw, dict) else 1
        if page >= total_pages:
            break
        page += 1

    projects_raw = _fetch("/api/projects")
    projects = projects_raw if isinstance(projects_raw, list) else projects_raw.get("data", projects_raw.get("items", []))

    logger.info("wiki: %d contatos, %d gravacoes, %d projetos", len(contacts), len(recordings), len(projects))

    contact_names, recording_titles, project_names = [], [], []

    if not only or only == "contacts":
        contact_names = _build_contacts(contacts, recordings, projects)
    if not only or only == "recordings":
        recording_titles = _build_recordings(recordings, contacts)
    if not only or only == "projects":
        project_names = _build_projects(projects, contacts, recordings)

    # Se rodou parcial, completar listas com o que ja existe no disco
    if only:
        contact_names   = contact_names   or [f.stem for f in (WIKI_DIR / "contacts").glob("*.md")]   if (WIKI_DIR / "contacts").exists()   else []
        recording_titles = recording_titles or [f.stem for f in (WIKI_DIR / "recordings").glob("*.md")] if (WIKI_DIR / "recordings").exists() else []
        project_names   = project_names   or [f.stem for f in (WIKI_DIR / "projects").glob("*.md")]   if (WIKI_DIR / "projects").exists()   else []

    if not only or only == "index":
        _build_index(contact_names, recording_titles, project_names)

    _append_log(len(contact_names), len(recording_titles), len(project_names))
    logger.info("wiki: concluida — %d contatos, %d gravacoes, %d projetos",
                len(contact_names), len(recording_titles), len(project_names))


# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/rebuild", dependencies=[Depends(_require_wiki_key)])
async def rebuild_wiki(background_tasks: BackgroundTasks, only: str | None = None):
    """Dispara regeneracao do LLM Wiki em background."""
    background_tasks.add_task(_generate_wiki, only)
    return {"status": "rebuilding", "only": only or "all", "message": "Wiki sendo gerada em background"}


@router.get("/graph")
async def wiki_graph():
    """Retorna nodes + edges para o grafo visual. Protegido pelo middleware global."""
    if not WIKI_DIR.exists():
        return {"nodes": [], "edges": [], "error": "wiki nao gerada ainda — rode /api/wiki/rebuild primeiro"}

    nodes, edges = [], []
    seen_nodes, seen_edges = set(), set()

    for md_file in sorted(WIKI_DIR.rglob("*.md")):
        if md_file.name in ("index.md", "log.md"):
            continue
        folder = md_file.parent.name
        if folder in ("wiki", "storage"):
            continue

        node_id = md_file.stem
        if node_id in seen_nodes:
            continue
        seen_nodes.add(node_id)

        lines = md_file.read_text(encoding="utf-8", errors="replace").splitlines()
        title = lines[0].lstrip("# ").strip() if lines else node_id
        nodes.append({"id": node_id, "label": title, "type": folder})

        content = "\n".join(lines)
        for link in re.findall(r"\[\[([^\]]+)\]\]", content):
            target_id = re.sub(r"[^\w\s-]", "", link.lower())
            target_id = re.sub(r"[\s_]+", "-", target_id).strip("-")
            if not target_id or target_id == node_id:
                continue
            edge_key = tuple(sorted([node_id, target_id]))
            if edge_key not in seen_edges:
                seen_edges.add(edge_key)
                edges.append({"source": node_id, "target": target_id})

    if not nodes:
        return {"nodes": [], "edges": [], "error": "wiki nao gerada ainda — rode /api/wiki/rebuild primeiro"}

    return {"nodes": nodes, "edges": edges}


@router.get("/status", dependencies=[Depends(_require_wiki_key)])
async def wiki_status():
    """Retorna as ultimas entradas do log de geracao."""
    log_path = WIKI_DIR / "log.md"
    if not log_path.exists():
        return {"status": "never_run", "log": []}
    lines = log_path.read_text(encoding="utf-8", errors="replace").splitlines()
    entries = [l for l in lines if l.startswith("- **")][-10:]
    return {"status": "ok", "log": entries}
