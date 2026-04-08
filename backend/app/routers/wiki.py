"""
Wiki router — gera/atualiza o LLM Wiki da Orquestra.

POST /api/wiki/rebuild  → dispara regeneração em background
GET  /api/wiki/status   → mostra última geração (via log.md)
"""

import subprocess
import sys
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.config import settings

router = APIRouter()

_bearer = HTTPBearer(auto_error=False)


def _require_wiki_key(
    credentials: HTTPAuthorizationCredentials | None = Security(_bearer),
):
    """
    Valida a WIKI_SECRET_KEY.
    Aceita o token tanto no header Authorization: Bearer <token>
    quanto via query param ?token=<token> (conveniente para testes rápidos).
    Recusa com 403 se a key não estiver configurada ou não bater.
    """
    expected = settings.WIKI_SECRET_KEY
    if not expected:
        raise HTTPException(status_code=503, detail="WIKI_SECRET_KEY não configurada no servidor")

    token = credentials.credentials if credentials else None
    if not token or token != expected:
        raise HTTPException(status_code=403, detail="Token inválido para /api/wiki")

# Caminho do script gerador (relativo ao volume Docker ou local)
# No Docker: /app/storage/wiki/generate_wiki.py
# Local:     D:/projetos/orquestra/storage/wiki/generate_wiki.py
def _wiki_script_path() -> Path:
    candidates = [
        Path("/app/storage/wiki/generate_wiki.py"),
        Path(__file__).resolve().parents[3] / "storage" / "wiki" / "generate_wiki.py",
    ]
    for p in candidates:
        if p.exists():
            return p
    raise FileNotFoundError("generate_wiki.py nao encontrado")


def _run_wiki(only: str | None = None):
    """Executa o script de geração de wiki como subprocess."""
    script = _wiki_script_path()
    cmd = [sys.executable, str(script)]
    if only:
        cmd += ["--only", only]
    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=300,
        cwd=str(script.parent),
    )
    if result.returncode != 0:
        raise RuntimeError(f"Wiki generation failed:\n{result.stderr[-500:]}")
    return result.stdout


@router.post("/rebuild", dependencies=[Depends(_require_wiki_key)])
async def rebuild_wiki(
    background_tasks: BackgroundTasks,
    only: str | None = None,
):
    """
    Dispara regeneração do LLM Wiki em background.

    Params:
      only: contacts | recordings | projects | index (opcional, gera tudo se omitido)
    """
    try:
        _wiki_script_path()  # valida que o script existe antes de enfileirar
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))

    background_tasks.add_task(_run_wiki, only)
    return {"status": "rebuilding", "only": only or "all", "message": "Wiki sendo gerada em background"}


@router.get("/graph")
async def wiki_graph():
    """
    Lê os arquivos .md do wiki e retorna nodes + edges para o grafo visual.
    Protegido pelo middleware global APP_SECRET_KEY (sem WIKI_SECRET_KEY aqui).
    Parseia [[backlinks]] de cada arquivo para construir as arestas.
    """
    import re
    try:
        wiki_dir = _wiki_script_path().parent
    except FileNotFoundError:
        return {"nodes": [], "edges": [], "error": "wiki nao gerada ainda — rode /api/wiki/rebuild primeiro"}

    nodes = []
    edges = []
    seen_nodes = set()
    seen_edges = set()

    for md_file in sorted(wiki_dir.rglob("*.md")):
        if md_file.name in ("index.md", "log.md"):
            continue
        folder = md_file.parent.name  # "contacts" | "recordings" | "projects"
        if folder == "wiki":  # arquivos na raiz (index, log) — já ignorados acima
            continue

        node_id = md_file.stem
        if node_id in seen_nodes:
            continue
        seen_nodes.add(node_id)

        lines = md_file.read_text(encoding="utf-8", errors="replace").splitlines()
        title = lines[0].lstrip("# ").strip() if lines else node_id
        nodes.append({"id": node_id, "label": title, "type": folder})

        # Extrair [[backlinks]] do conteúdo
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

    return {"nodes": nodes, "edges": edges}


@router.get("/status", dependencies=[Depends(_require_wiki_key)])
async def wiki_status():
    """Retorna as últimas entradas do log de geração."""
    try:
        log_path = _wiki_script_path().parent / "log.md"
    except FileNotFoundError:
        return {"status": "not_found", "log": []}

    if not log_path.exists():
        return {"status": "never_run", "log": []}

    lines = log_path.read_text(encoding="utf-8", errors="replace").splitlines()
    # Retornar últimas 20 linhas significativas
    entries = [l for l in lines if l.startswith("- **")][-10:]
    return {"status": "ok", "log": entries}
