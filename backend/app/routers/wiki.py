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
import asyncio
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


# ─── Helpers de filtragem ─────────────────────────────────────────────────────

_NOMES_INVALIDOS = {
    "sem nome", "sem-nome", ".", "sr :)", "teste manual",
    "teste", "test", "sem nome", "grupo fiel ia",
}

def _is_nome_valido(name: str | None) -> bool:
    """Filtra contatos sem nome real: numeros puros, sem-nome, nomes arabicos, etc."""
    if not name:
        return False
    name = name.strip()
    if len(name) < 3:
        return False
    if name.lower() in _NOMES_INVALIDOS:
        return False
    # Numero puro (ex: "5551993448124")
    if name.replace("+", "").replace(" ", "").replace("-", "").isdigit():
        return False
    # Caracteres nao-latinos majoritarios (arabico, emojis especiais, etc)
    latin_chars = sum(1 for c in name if ord(c) < 1000)
    if latin_chars < len(name) * 0.6:
        return False
    return True


def _is_cliente_ativo(c: dict) -> bool:
    """Retorna True se o contato deve aparecer no wiki (cliente/parceiro real)."""
    if c.get("ignored"):
        return False
    if c.get("is_group"):
        return False
    if not _is_nome_valido(c.get("name")):
        return False
    # Tem mensagens, notas ou engagement
    has_activity = (
        c.get("last_message_at") is not None
        or (c.get("engagement_score") or 0) > 0
        or bool(c.get("notes"))
        or bool(c.get("monthly_revenue"))
    )
    return has_activity


# Cache de propostas para evitar fetch por contato
_proposals_cache: list[dict] = []

def _load_proposals_cache() -> list[dict]:
    global _proposals_cache
    if _proposals_cache:
        return _proposals_cache
    try:
        raw = _fetch("/api/proposals?limit=200")
        _proposals_cache = raw if isinstance(raw, list) else raw.get("items", raw.get("data", []))
    except Exception as e:
        logger.warning("wiki: erro ao buscar propostas: %s", e)
        _proposals_cache = []
    return _proposals_cache


def _fetch_proposals_for(contact_id: str, phone: str) -> list[dict]:
    all_props = _load_proposals_cache()
    return [
        p for p in all_props
        if p.get("contact_id") == contact_id
        or (phone and phone != "?" and p.get("client_phone") == phone)
    ]


def _fetch_tasks_for_project(project_id: str) -> list[dict]:
    if not project_id:
        return []
    try:
        raw = _fetch(f"/api/tasks?project_id={project_id}&limit=10")
        tasks = raw if isinstance(raw, list) else raw.get("items", raw.get("data", []))
        # So tarefas abertas
        return [t for t in tasks if t.get("status") not in ("done",)]
    except Exception as e:
        logger.warning("wiki: erro ao buscar tasks projeto %s: %s", project_id, e)
        return []


# ─── Geradores ────────────────────────────────────────────────────────────────

def _fetch_messages(contact_id: str, limit: int = 100) -> list[dict]:
    """Busca ultimas mensagens WhatsApp de um contato."""
    try:
        raw = _fetch(f"/api/messages?contact_id={contact_id}&limit={limit}")
        msgs = raw if isinstance(raw, list) else raw.get("items", raw.get("messages", raw.get("data", [])))
        return msgs or []
    except Exception as e:
        logger.warning("wiki: erro ao buscar msgs do contato %s: %s", contact_id, e)
        return []


async def _summarize_conversation(contact_name: str, messages: list[dict]) -> str:
    """Gera resumo do historico completo de conversa usando LLM."""
    try:
        from app.services.llm import chat_completion

        # Montar transcript completo (mais antigo -> mais recente, invertido pois API retorna recente primeiro)
        transcript_lines = []
        for m in reversed(messages):
            content = (m.get("content") or m.get("transcription") or "").strip()
            if not content:
                continue
            direction = "Diego" if m.get("direction") == "outgoing" else contact_name
            ts = (m.get("timestamp") or m.get("created_at") or "")[:10]
            transcript_lines.append(f"[{ts}] {direction}: {content[:300]}")

        if not transcript_lines:
            return ""

        transcript = "\n".join(transcript_lines[-80:])  # max 80 msgs para o prompt

        prompt = f"""Analise essa conversa de WhatsApp entre Diego (empreendedor de automacao B2B) e {contact_name}.

Resumo em 3-5 paragrafos curtos:
1. Quem e esse contato e qual o contexto do relacionamento
2. Principais topicos ja discutidos
3. Status atual / o que esta pendente
4. Tom da relacao (cliente, parceiro, prospect, etc)

Seja direto e factual. Nao invente informacao que nao esta na conversa.

CONVERSA:
{transcript}"""

        result = await chat_completion(
            [{"role": "user", "content": prompt}],
            model=settings.MODEL_CHAT_CHEAP,
            max_tokens=600,
            temperature=0.2,
        )
        return result.strip()
    except Exception as e:
        logger.warning("wiki: erro ao sumarizar conversa de %s: %s", contact_name, e)
        return ""


def _build_contacts(contacts, recordings, projects) -> list[str]:
    names = []
    contact_names = [c.get("name", "") for c in contacts if c.get("name")]

    # Mapas para lookup rapido
    project_by_id   = {p.get("id", ""): p for p in projects}
    project_by_name = {p.get("name", ""): p for p in projects}

    def recs_for(name):
        nl = name.lower()
        return [r for r in recordings if nl in (r.get("title") or "").lower() or nl in (r.get("summary") or "").lower()]

    for c in contacts:
        name       = c.get("name") or "Sem Nome"
        phone      = c.get("phone") or "?"
        created    = _fmt_date(c.get("created_at"))
        tags       = c.get("tags") or []
        notes      = c.get("notes") or ""
        contact_id = c.get("id") or ""
        pipeline   = c.get("pipeline_stage") or "lead"
        revenue_m  = c.get("monthly_revenue") or ""
        revenue_t  = c.get("total_revenue") or ""
        next_action = c.get("next_action") or ""
        next_action_date = _fmt_date(c.get("next_action_date"))
        last_msg_at = _fmt_date(c.get("last_message_at"))
        company    = c.get("company") or ""
        email      = c.get("email") or ""
        unread     = c.get("unread_count") or 0
        acquired   = _fmt_date(c.get("acquired_at"))
        support_ends = _fmt_date(c.get("support_ends_at"))
        engagement = c.get("engagement_score") or 0

        # Projeto via project_id direto (prioritario)
        contact_project_id = c.get("project_id")
        related_projects = []
        if contact_project_id and contact_project_id in project_by_id:
            related_projects = [project_by_id[contact_project_id].get("name")]
        # Fallback: substring match
        if not related_projects:
            related_projects = [p.get("name") for p in projects if name.lower() in (p.get("name") or "").lower()]

        related_recordings = recs_for(name)

        lines = [
            f"# {name}", "",
            f"> Contato WhatsApp | Pipeline: `{pipeline}` | Ultima msg: {last_msg_at}", "",
            "## Status Comercial",
            f"- **Pipeline:** `{pipeline}`",
            f"- **Telefone:** `{phone}`",
            f"- **Tags:** {', '.join(tags) if tags else 'nenhuma'}",
            f"- **Engagement:** {engagement}/100",
        ]
        if company:
            lines.append(f"- **Empresa:** {company}")
        if email:
            lines.append(f"- **Email:** `{email}`")
        if revenue_m:
            lines.append(f"- **Receita mensal:** {revenue_m}")
        if revenue_t:
            lines.append(f"- **Receita total:** {revenue_t}")
        if acquired and acquired != "?":
            lines.append(f"- **Cliente desde:** {acquired}")
        if support_ends and support_ends != "?":
            lines.append(f"- **Suporte ate:** {support_ends}")
        if next_action:
            lines.append(f"- **Proximo passo:** {next_action}" + (f" (ate {next_action_date})" if next_action_date != "?" else ""))
        if unread > 0:
            lines.append(f"- **Mensagens nao lidas:** {unread}")

        if notes:
            lines += ["", "## Notas", notes]

        # Propostas
        proposals = _fetch_proposals_for(contact_id, phone)
        if proposals:
            lines += ["", "## Propostas"]
            for p in proposals[:8]:
                status = p.get("status", "?")
                value  = p.get("total_value") or "?"
                title  = p.get("title") or "?"
                date   = _fmt_date(p.get("created_at"))
                lines.append(f"- `[{status}]` **{title}** — R$ {value} ({date})")

        if related_projects:
            lines += ["", "## Projetos Relacionados"]
            for pname in related_projects:
                lines.append(f"- {_wikilink(pname)}")
                # Tasks abertas do projeto
                proj_obj = project_by_name.get(pname, {})
                proj_id  = proj_obj.get("id") or ""
                tasks = _fetch_tasks_for_project(proj_id)
                for t in tasks[:5]:
                    prio   = t.get("priority", "")
                    status = t.get("status", "")
                    title  = t.get("title", "")
                    lines.append(f"  - `[{status}]` {title}" + (f" _{prio}_" if prio else ""))

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
            messages = _fetch_messages(contact_id, limit=100)
            text_msgs = [m for m in messages if m.get("content") or m.get("transcription")]

            if text_msgs:
                # Resumo do historico completo via LLM
                conv_summary = asyncio.run(_summarize_conversation(name, text_msgs))
                if conv_summary:
                    lines += ["", "## Historico WhatsApp (resumo)", conv_summary]

                # Ultimas 10 mensagens literais
                lines += ["", f"## Mensagens Recentes ({min(10, len(text_msgs))} de {len(text_msgs)})"]
                for m in text_msgs[:10]:
                    direction = "→" if m.get("direction") == "outgoing" else "←"
                    ts = (m.get("timestamp") or m.get("created_at") or "")[:10]
                    content = (m.get("content") or m.get("transcription") or "").strip().replace("\n", " ")[:200]
                    if content:
                        lines.append(f"- `{ts}` {direction} {content}")

        # Memoria rica dos agentes Jarbas Lab (ingerida via POST /api/wiki/memory)
        memory_dir = WIKI_DIR / "memory"
        if memory_dir.exists():
            # Buscar pasta de memoria que melhor corresponde ao contato
            contact_slug = _slug(name)
            matched_dir = None
            for mem_folder in memory_dir.iterdir():
                if not mem_folder.is_dir():
                    continue
                # Match: slug do contato no nome da pasta ou vice-versa
                if contact_slug in mem_folder.name or mem_folder.name.split("-")[0] in contact_slug:
                    matched_dir = mem_folder
                    break

            if matched_dir:
                MEMORY_SECTIONS = {
                    "context": "Contexto Operacional",
                    "decisions": "Decisoes Historicas",
                    "pending": "Action Items Pendentes",
                    "calls": "Calls Registradas",
                }
                for fname, section_title in MEMORY_SECTIONS.items():
                    fpath = matched_dir / f"{fname}.md"
                    if fpath.exists():
                        content = fpath.read_text(encoding="utf-8", errors="replace").strip()
                        if content:
                            lines += ["", f"## {section_title}", content[:3000]]

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

        proj_id     = p.get("id") or ""
        status      = p.get("status") or "?"
        description = p.get("description") or ""
        created     = _fmt_date(p.get("created_at"))
        keywords    = p.get("keywords") or []
        creds       = p.get("credentials") or {}
        stats       = p.get("stats") or {}

        # Stack real vem dentro de credentials
        stack       = creds.get("stack") or p.get("stack") or p.get("tech_stack") or ""
        github      = creds.get("github") or {}
        urls        = creds.get("urls") or {}
        easypanel   = creds.get("easypanel") or {}

        # Dono do projeto (match reverso via project_id no contato)
        owners = [c for c in contacts if c.get("project_id") == proj_id]
        owner_names = [c.get("name") for c in owners]

        # Contatos mencionados no nome/descricao (fallback)
        mentioned = find_contacts(name + " " + description)
        # Unir donos + mencionados sem duplicata
        all_contacts = list(dict.fromkeys(owner_names + mentioned))

        related_recs = recs_for(name)

        # Tasks e propostas do projeto
        tasks = _fetch_tasks_for_project(proj_id)
        owner_phones = [c.get("phone") for c in owners if c.get("phone")]
        proposals = [
            pr for pr in _load_proposals_cache()
            if pr.get("client_phone") in owner_phones
            or any(pr.get("contact_id") == o.get("id") for o in owners)
        ]

        lines = [f"# {name}", "", f"> Projeto | Status: `{status}` | Criado em: {created}", ""]

        if description:
            lines += ["## Descricao", description, ""]

        if stack:
            lines += ["## Stack", f"`{stack}`", ""]

        if keywords:
            lines += ["## Keywords", ", ".join(f"`{k}`" for k in keywords), ""]

        # URLs e infra (sem secrets)
        url_lines = []
        for label, url in urls.items():
            if url:
                url_lines.append(f"- **{label}:** `{url}`")
        if github.get("repo"):
            url_lines.append(f"- **GitHub:** `{github['repo']}` (branch: `{github.get('branch', 'main')}`)")
        if easypanel.get("project"):
            url_lines.append(f"- **EasyPanel:** projeto `{easypanel['project']}` em `{easypanel.get('ip', '?')}`")
        if url_lines:
            lines += ["## URLs e Infra"] + url_lines + [""]

        # Stats do projeto
        total_msgs = stats.get("total_messages", 0)
        total_recs = stats.get("total_recordings", 0)
        last_activity = _fmt_date(stats.get("last_activity"))
        if total_msgs or total_recs:
            lines += [
                "## Metricas",
                f"- **Mensagens:** {total_msgs}",
                f"- **Gravacoes:** {total_recs}",
                f"- **Ultima atividade:** {last_activity}",
                "",
            ]

        # Dono/contatos
        if all_contacts:
            lines += ["## Dono e Contatos"]
            for cn in all_contacts:
                lines.append(f"- {_wikilink(cn)}")
            lines.append("")

        # Propostas
        if proposals:
            lines += ["## Propostas"]
            for pr in proposals[:8]:
                pr_status = pr.get("status", "?")
                pr_value  = pr.get("total_value") or "?"
                pr_title  = pr.get("title") or "?"
                pr_date   = _fmt_date(pr.get("created_at"))
                lines.append(f"- `[{pr_status}]` **{pr_title}** — R$ {pr_value} ({pr_date})")
            lines.append("")

        # Tasks abertas
        if tasks:
            lines += ["## Tasks Abertas"]
            for t in tasks[:10]:
                t_prio   = t.get("priority", "")
                t_status = t.get("status", "")
                t_title  = t.get("title", "")
                lines.append(f"- `[{t_status}]` {t_title}" + (f" _{t_prio}_" if t_prio else ""))
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
    global _proposals_cache
    _proposals_cache = []  # limpar cache a cada geracao
    logger.info("wiki: iniciando geracao (only=%s)", only)

    # Buscar contatos e filtrar apenas clientes ativos reais
    contacts_raw = _fetch("/api/contacts?limit=200&is_group=false")
    all_contacts = contacts_raw if isinstance(contacts_raw, list) else contacts_raw.get("data", contacts_raw.get("items", []))
    contacts = [c for c in all_contacts if _is_cliente_ativo(c)]
    logger.info("wiki: %d/%d contatos passaram no filtro de clientes ativos", len(contacts), len(all_contacts))

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

    # Limpar arquivos orfaos de geracoes anteriores (contacts e projects podem mudar)
    if not only or only == "contacts":
        contacts_dir = WIKI_DIR / "contacts"
        if contacts_dir.exists():
            valid_slugs = {_slug(c.get("name", "")) for c in contacts}
            for f in contacts_dir.glob("*.md"):
                if f.stem not in valid_slugs:
                    f.unlink()
                    logger.info("wiki: removido contato orfao %s", f.name)

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


@router.get("/node/{node_type}/{slug}")
async def wiki_node(node_type: str, slug: str):
    """Retorna conteudo do .md de um node do wiki para exibicao no painel lateral."""
    if node_type not in ("contacts", "projects", "recordings"):
        raise HTTPException(status_code=400, detail="node_type invalido")
    md_path = WIKI_DIR / node_type / f"{slug}.md"
    if not md_path.exists():
        raise HTTPException(status_code=404, detail="Node nao encontrado")

    content = md_path.read_text(encoding="utf-8", errors="replace")

    # Extrair secoes estruturadas para o frontend
    sections: list[dict] = []
    current_title = ""
    current_lines: list[str] = []

    for line in content.splitlines():
        if line.startswith("## "):
            if current_title:
                sections.append({"title": current_title, "content": "\n".join(current_lines).strip()})
            current_title = line[3:].strip()
            current_lines = []
        elif line.startswith("# "):
            continue  # titulo principal ja esta no node
        else:
            current_lines.append(line)

    if current_title:
        sections.append({"title": current_title, "content": "\n".join(current_lines).strip()})

    # Extrair subtitulo (linha >) para contexto rapido
    subtitle = ""
    for line in content.splitlines():
        if line.startswith("> ") and not subtitle:
            subtitle = line[2:].strip()

    return {
        "slug": slug,
        "type": node_type,
        "content": content,
        "subtitle": subtitle,
        "sections": sections,
    }


@router.post("/memory", dependencies=[Depends(_require_wiki_key)])
async def ingest_memory(data: dict):
    """Recebe dados de memoria dos agentes Jarbas Lab para enriquecer a wiki.

    Body JSON:
    {
        "contact_slug": "emilio-superbot",
        "files": {
            "context": "conteudo do context.md...",
            "decisions": "conteudo do decisions.md...",
            "pending": "conteudo do pending.md...",
            "calls": "conteudo do calls.md...",
            "profile": "conteudo do profile.md..."
        }
    }
    """
    slug = data.get("contact_slug")
    files = data.get("files", {})
    if not slug or not files:
        raise HTTPException(status_code=400, detail="contact_slug e files sao obrigatorios")

    memory_dir = WIKI_DIR / "memory" / slug
    memory_dir.mkdir(parents=True, exist_ok=True)

    saved = []
    for fname, content in files.items():
        if not content:
            continue
        safe_name = re.sub(r"[^\w-]", "", fname)
        path = memory_dir / f"{safe_name}.md"
        path.write_text(content, encoding="utf-8")
        saved.append(safe_name)
        logger.info("wiki: memory saved %s/%s.md", slug, safe_name)

    return {"status": "ok", "slug": slug, "files_saved": saved}


@router.get("/status", dependencies=[Depends(_require_wiki_key)])
async def wiki_status():
    """Retorna as ultimas entradas do log de geracao."""
    log_path = WIKI_DIR / "log.md"
    if not log_path.exists():
        return {"status": "never_run", "log": []}
    lines = log_path.read_text(encoding="utf-8", errors="replace").splitlines()
    entries = [l for l in lines if l.startswith("- **")][-10:]
    return {"status": "ok", "log": entries}
