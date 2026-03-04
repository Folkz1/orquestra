"""
Orquestra - Project Sync Service
Syncs git state from local project directories into the Orquestra database.
"""

import asyncio
import logging
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Project
from app.services.memory import store_memory

logger = logging.getLogger(__name__)

# Registry of all projects (from CLAUDE.md)
PROJECT_REGISTRY = [
    {"name": "Jarbas Memory Core", "path": "D:/jarbas_vida", "stack": "Node Express JSON"},
    {"name": "Remote Executor", "path": "D:/jarbas_vida/skills/remote-executor", "stack": "Node Express Puppeteer"},
    {"name": "Orchestrator v1", "path": "D:/jarbas_vida/orchestrator", "stack": "PowerShell Claude Codex"},
    {"name": "Motor 100k", "path": "D:/jarbas_vida/motor100k", "stack": "Dados/Insights"},
    {"name": "Motor 100k YouTube", "path": "D:/jarbas_vida/motor100k_youtube", "stack": "Dados/Briefings"},
    {"name": "LicitaAI", "path": "D:/projetos/licitaai", "stack": "Next.js React TS PostgreSQL OpenAI"},
    {"name": "CRM Juridico (Lexcod)", "path": "D:/projetos/crm/crm-juridico", "stack": "React TS Express PostgreSQL Stripe"},
    {"name": "Fiel IA", "path": "D:/projetos/timao!/fiel-ia", "stack": "Next.js React TS Prisma PostgreSQL"},
    {"name": "Projeto Superbot", "path": "D:/projetos/projeto-superbot", "stack": "Node Express Next.js"},
    {"name": "IssueMapper", "path": "D:/projetos/issuemapper", "stack": "N8N PostgreSQL Python Bitrix24"},
    {"name": "Orquestra", "path": "D:/projetos/orquestra", "stack": "FastAPI SQLAlchemy React Vite"},
    {"name": "OCR Supreme", "path": "D:/projetos/ocr_supreme", "stack": "Python OCR"},
    {"name": "Scraper Selecty", "path": "D:/projetos/Scraping-/Scraper-selecty", "stack": "Node Express Puppeteer Docker"},
]


async def _run_git(path: str, *args: str) -> tuple[int, str]:
    """Run a git command asynchronously. Returns (returncode, stdout)."""
    try:
        proc = await asyncio.create_subprocess_exec(
            "git", *args,
            cwd=path,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=30)
        return proc.returncode, stdout.decode("utf-8", errors="replace").strip()
    except FileNotFoundError:
        return -1, f"Directory not found: {path}"
    except asyncio.TimeoutError:
        return -1, "Git command timed out"
    except Exception as exc:
        return -1, str(exc)


async def _gather_git_info(path: str) -> dict | None:
    """Gather git info for a project directory."""
    # Check if directory has .git
    rc, branch = await _run_git(path, "rev-parse", "--abbrev-ref", "HEAD")
    if rc != 0:
        return None

    # Last commit
    rc, last_commit = await _run_git(
        path, "log", "-1", "--format=%h %s (%ar)"
    )

    # Commits in last 7 days
    rc, commits_7d_raw = await _run_git(
        path, "log", "--oneline", "--since=7 days ago"
    )
    commits_7d = len(commits_7d_raw.splitlines()) if commits_7d_raw else 0

    # Modified files (working tree)
    rc, status_raw = await _run_git(path, "status", "--porcelain")
    modified_files = []
    if status_raw:
        for line in status_raw.splitlines()[:20]:  # cap at 20
            if len(line) > 3:
                modified_files.append(line[3:].strip())

    return {
        "branch": branch,
        "last_commit": last_commit or "no commits",
        "commits_7d": commits_7d,
        "modified_files": modified_files,
    }


async def _detect_stack(path: str) -> list[str]:
    """Detect stack from package.json or requirements.txt."""
    import os
    keywords = []

    pkg_path = os.path.join(path, "package.json")
    if os.path.isfile(pkg_path):
        try:
            import json
            with open(pkg_path, "r", encoding="utf-8") as f:
                pkg = json.load(f)
            deps = {**pkg.get("dependencies", {}), **pkg.get("devDependencies", {})}
            for key in ["next", "react", "express", "fastify", "vue", "svelte", "prisma", "tailwindcss"]:
                if key in deps:
                    keywords.append(key)
        except Exception:
            pass

    req_path = os.path.join(path, "requirements.txt")
    if os.path.isfile(req_path):
        try:
            with open(req_path, "r", encoding="utf-8") as f:
                content = f.read().lower()
            for key in ["fastapi", "django", "flask", "sqlalchemy", "pandas", "pytorch"]:
                if key in content:
                    keywords.append(key)
        except Exception:
            pass

    return keywords


async def sync_all_projects(db: AsyncSession) -> list[dict]:
    """
    Sync all registered projects: gather git info, upsert Project records,
    and store a memory entry for each.

    Returns list of sync results.
    """
    results = []

    for entry in PROJECT_REGISTRY:
        name = entry["name"]
        path = entry["path"]
        result = {"name": name, "path": path, "status": "error", "detail": ""}

        try:
            git_info = await _gather_git_info(path)
            if git_info is None:
                result["detail"] = "Not a git repo or directory not found"
                results.append(result)
                continue

            # Detect stack keywords
            detected = await _detect_stack(path)
            stack_str = entry.get("stack", "")
            if detected:
                stack_str = f"{stack_str} ({', '.join(detected)})"

            # Upsert Project by name
            stmt = select(Project).where(Project.name == name)
            db_result = await db.execute(stmt)
            project = db_result.scalar_one_or_none()

            description = (
                f"Branch: {git_info['branch']}\n"
                f"Last commit: {git_info['last_commit']}\n"
                f"Commits (7d): {git_info['commits_7d']}\n"
                f"Modified files: {len(git_info['modified_files'])}\n"
                f"Stack: {stack_str}\n"
                f"Path: {path}"
            )

            if project:
                project.description = description
                project.keywords = detected or project.keywords
                result["status"] = "updated"
            else:
                project = Project(
                    name=name,
                    description=description,
                    status="active",
                    keywords=detected or [],
                )
                db.add(project)
                result["status"] = "created"

            await db.flush()

            # Store memory
            memory_content = (
                f"Project sync: {name}\n{description}\n"
                f"Modified: {', '.join(git_info['modified_files'][:10]) or 'clean'}"
            )
            await store_memory(
                db=db,
                content=memory_content,
                source_type="project_sync",
                project_name=name,
                metadata={
                    "branch": git_info["branch"],
                    "commits_7d": git_info["commits_7d"],
                    "modified_files": git_info["modified_files"][:10],
                    "synced_at": datetime.now(timezone.utc).isoformat(),
                },
                summary=f"{name}: {git_info['branch']} branch, {git_info['commits_7d']} commits (7d), {len(git_info['modified_files'])} modified files",
            )

            result["detail"] = git_info
            results.append(result)

            logger.info("[SYNC] %s: %s (branch=%s, commits_7d=%d)",
                        result["status"], name, git_info["branch"], git_info["commits_7d"])

        except Exception as exc:
            result["detail"] = str(exc)
            results.append(result)
            logger.error("[SYNC] Error syncing %s: %s", name, exc)

    return results
