"""
Playbook CTO Virtual — Educational Platform API
Public routes for students + Admin routes for Diego
"""

from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy import select, func, text
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from datetime import datetime, timezone

from app.database import get_db

router = APIRouter()

MANUAL_TRIAL_PAYMENT_METHOD = "manual_whatsapp_pending"
MANUAL_PAID_PAYMENT_METHOD = "manual_whatsapp_paid"
HIDDEN_MODULE_SLUGS = {"fundacao", "orchestrator"}
HIDDEN_MODULE_SLUGS_SQL = ", ".join(f"'{slug}'" for slug in sorted(HIDDEN_MODULE_SLUGS))


def _normalize_phone(phone: str | None) -> str:
    return "".join(ch for ch in (phone or "") if ch.isdigit())


def _is_hidden_module_slug(slug: str | None) -> bool:
    return (slug or "").strip().lower() in HIDDEN_MODULE_SLUGS


def _row_value(row, key: str):
    if row is None:
        return None
    if isinstance(row, dict):
        return row.get(key)
    if hasattr(row, key):
        return getattr(row, key)
    try:
        return row[key]
    except Exception:
        return None


def _access_mode_from_enrollment(row) -> str:
    payment_method = (_row_value(row, "payment_method") or "").strip()
    expires_at = _row_value(row, "expires_at")
    tier = (_row_value(row, "tier") or "free").strip()
    is_active = _row_value(row, "is_active")
    active = True if is_active is None else bool(is_active)
    now = datetime.now(timezone.utc)

    if payment_method == MANUAL_TRIAL_PAYMENT_METHOD:
        if not active or (expires_at and expires_at <= now):
            return "expired_trial"
        return "manual_trial"

    if tier == "pro" and active:
        if payment_method == MANUAL_PAID_PAYMENT_METHOD:
            return "paid_manual"
        return "member"

    return "free"


def _has_active_content_access(row) -> bool:
    return _access_mode_from_enrollment(row) in {"manual_trial", "paid_manual", "member"}


def _trial_expired_detail() -> dict:
    return {
        "code": "trial_expired",
        "message": "Seu acesso de 6 horas expirou. Responde meu WhatsApp para concluir a assinatura.",
    }


async def _get_enrollment_by_phone(db: AsyncSession, phone: str):
    normalized_phone = _normalize_phone(phone)
    if not normalized_phone:
        return None

    result = await db.execute(
        text(
            """
            SELECT id, phone, name, email, tier, is_active, enrolled_at, expires_at, payment_method, notes
            FROM playbook_enrollments
            WHERE phone = :phone
            LIMIT 1
            """
        ),
        {"phone": normalized_phone},
    )
    return result.mappings().first()


# ── Schemas ──────────────────────────────────────────

class ModuleOut(BaseModel):
    id: str
    slug: str
    title: str
    description: str | None
    tier: str
    icon: str
    order_num: int
    step_count: int = 0
    duration_min: int = 0

class StepOut(BaseModel):
    id: str
    slug: str
    title: str
    content: str
    step_type: str
    order_num: int
    duration_min: int | None
    code_snippet: str | None
    is_completed: bool = False

class ModuleDetail(BaseModel):
    id: str
    slug: str
    title: str
    description: str | None
    tier: str
    icon: str
    steps: list[StepOut]

class ProgressIn(BaseModel):
    phone: str
    step_id: str

class EnrollIn(BaseModel):
    phone: str
    name: str
    email: str | None = None

class EnrollOut(BaseModel):
    id: str
    phone: str
    name: str
    email: str | None
    tier: str
    enrolled_at: str
    expires_at: str | None = None
    payment_method: str | None = None
    access_mode: str = "free"
    completed_steps: int = 0
    total_steps: int = 0

class ModuleAdmin(BaseModel):
    slug: str
    title: str
    description: str | None = None
    tier: str = "free"
    icon: str = "📘"
    order_num: int = 0
    is_published: bool = False

class StepAdmin(BaseModel):
    slug: str
    title: str
    content: str
    step_type: str = "theory"
    order_num: int = 0
    duration_min: int = 5
    code_snippet: str | None = None
    is_published: bool = False


# ── Public Routes ────────────────────────────────────

@router.get("/modules")
async def list_modules(
    tier: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """List all published modules with step counts."""
    query = f"""
        SELECT m.id, m.slug, m.title, m.description, m.tier, m.icon, m.order_num,
               COUNT(s.id) AS step_count,
               COALESCE(SUM(s.duration_min), 0) AS duration_min
        FROM playbook_modules m
        LEFT JOIN playbook_steps s ON s.module_id = m.id AND s.is_published = true
        WHERE m.is_published = true
          AND m.slug NOT IN ({HIDDEN_MODULE_SLUGS_SQL})
    """
    params = {}
    if tier:
        query += " AND m.tier = :tier"
        params["tier"] = tier
    query += " GROUP BY m.id ORDER BY m.order_num"

    result = await db.execute(text(query), params)
    rows = result.mappings().all()
    return [ModuleOut(
        id=str(r["id"]), slug=r["slug"], title=r["title"],
        description=r["description"], tier=r["tier"], icon=r["icon"],
        order_num=r["order_num"], step_count=int(r["step_count"]),
        duration_min=int(r["duration_min"])
    ) for r in rows]


@router.get("/modules/{slug}")
async def get_module(
    slug: str,
    phone: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """Get module with all steps. If phone provided, includes progress."""
    normalized_slug = (slug or "").strip().lower()
    if _is_hidden_module_slug(normalized_slug):
        raise HTTPException(404, "Modulo nao encontrado")

    normalized_phone = _normalize_phone(phone)
    enrollment = await _get_enrollment_by_phone(db, normalized_phone)

    result = await db.execute(
        text("SELECT * FROM playbook_modules WHERE slug = :slug AND is_published = true"),
        {"slug": normalized_slug},
    )
    module = result.mappings().first()
    if not module:
        raise HTTPException(404, "Modulo nao encontrado")

    access_mode = _access_mode_from_enrollment(enrollment)
    if module["tier"] == "pro":
        if access_mode == "expired_trial":
            raise HTTPException(status_code=403, detail=_trial_expired_detail())
        if not enrollment or not _has_active_content_access(enrollment):
            raise HTTPException(
                status_code=403,
                detail={"code": "content_locked", "message": "Conteudo PRO disponivel apenas para membros ativos."},
            )

    result = await db.execute(
        text(
            """
            SELECT id, slug, title, COALESCE(content, '') AS content, step_type,
                   order_num, duration_min, code_snippet
            FROM playbook_steps
            WHERE module_id = CAST(:module_id AS uuid) AND is_published = true
            ORDER BY order_num
            """
        ),
        {"module_id": str(module["id"])},
    )
    steps = result.mappings().all()

    completed_step_ids = set()
    if enrollment:
        completed_result = await db.execute(
            text(
                """
                SELECT step_id
                FROM playbook_progress
                WHERE enrollment_id = CAST(:enrollment_id AS uuid)
                """
            ),
            {"enrollment_id": str(enrollment["id"])},
        )
        completed_step_ids = {str(step_id) for step_id in completed_result.scalars().all()}

    return ModuleDetail(
        id=str(module["id"]),
        slug=module["slug"],
        title=module["title"],
        description=module["description"],
        tier=module["tier"],
        icon=module["icon"],
        steps=[
            StepOut(
                id=str(step["id"]),
                slug=step["slug"],
                title=step["title"],
                content=step["content"],
                step_type=step["step_type"],
                order_num=step["order_num"],
                duration_min=step["duration_min"],
                code_snippet=step["code_snippet"],
                is_completed=str(step["id"]) in completed_step_ids,
            )
            for step in steps
        ],
    )

    normalized_phone = _normalize_phone(phone)
    enrollment = await _get_enrollment_by_phone(db, normalized_phone)

    # Get module
    result = await db.execute(
        text("SELECT * FROM playbook_modules WHERE slug = :slug AND is_published = true"),
        {"slug": slug}
    )
    module = result.mappings().first()
    if not module:
        raise HTTPException(404, "Módulo não encontrado")

    access_mode = _access_mode_from_enrollment(enrollment)
    if module["tier"] == "pro":
        if access_mode == "expired_trial":
            raise HTTPException(status_code=403, detail=_trial_expired_detail())
        if not enrollment or not _has_active_content_access(enrollment):
            raise HTTPException(
                status_code=403,
                detail={"code": "content_locked", "message": "Conteudo PRO disponivel apenas para membros ativos."},
            )

    # Get steps
    enrollment_id = str(enrollment["id"]) if enrollment else None
    result = await db.execute(
        text("""
            SELECT s.*,
                CASE WHEN :enrollment_id IS NOT NULL AND pp.id IS NOT NULL THEN true ELSE false END AS is_completed
            FROM playbook_steps s
            LEFT JOIN playbook_progress pp ON pp.step_id = s.id
                AND (:enrollment_id IS NOT NULL AND pp.enrollment_id = CAST(:enrollment_id AS uuid))
            WHERE s.module_id = CAST(:module_id AS uuid) AND s.is_published = true
            ORDER BY s.order_num
        """),
        {"module_id": str(module["id"]), "enrollment_id": enrollment_id}
    )
    steps = result.mappings().all()

    return ModuleDetail(
        id=str(module["id"]), slug=module["slug"], title=module["title"],
        description=module["description"], tier=module["tier"], icon=module["icon"],
        steps=[StepOut(
            id=str(s["id"]), slug=s["slug"], title=s["title"],
            content=s["content"], step_type=s["step_type"],
            order_num=s["order_num"], duration_min=s["duration_min"],
            code_snippet=s["code_snippet"], is_completed=s["is_completed"]
        ) for s in steps]
    )


@router.post("/enroll")
async def enroll(data: EnrollIn, db: AsyncSession = Depends(get_db)):
    """Register a new student (free tier)."""
    phone = _normalize_phone(data.phone)

    # Check existing
    result = await db.execute(
        text("SELECT id, tier FROM playbook_enrollments WHERE phone = :phone"),
        {"phone": phone}
    )
    existing = result.mappings().first()
    if existing:
        return {"id": str(existing["id"]), "tier": existing["tier"], "status": "already_enrolled"}

    result = await db.execute(
        text("""
            INSERT INTO playbook_enrollments (phone, name, email, tier)
            VALUES (:phone, :name, :email, 'free')
            RETURNING id, tier
        """),
        {"phone": phone, "name": data.name, "email": data.email}
    )
    row = result.mappings().first()
    await db.commit()
    return {"id": str(row["id"]), "tier": row["tier"], "status": "enrolled"}


@router.post("/upgrade")
async def upgrade_tier(data: dict, db: AsyncSession = Depends(get_db)):
    """Upgrade enrollment tier (admin only — protected by auth middleware)."""
    phone = _normalize_phone(data.get("phone"))
    tier = data.get("tier", "pro")
    result = await db.execute(
        text(
            """
            UPDATE playbook_enrollments
            SET tier = :tier, updated_at = NOW()
            WHERE phone = :phone
            RETURNING id, phone, tier
            """
        ),
        {"tier": tier, "phone": phone}
    )
    row = result.mappings().first()
    await db.commit()
    if not row:
        raise HTTPException(404, "Enrollment nao encontrado")
    return {"id": str(row["id"]), "phone": row["phone"], "tier": row["tier"], "status": "upgraded"}


@router.post("/progress")
async def mark_progress(data: ProgressIn, db: AsyncSession = Depends(get_db)):
    """Mark a step as completed for a student."""
    phone = _normalize_phone(data.phone)

    # Find enrollment
    enrollment = await _get_enrollment_by_phone(db, phone)
    if not enrollment:
        raise HTTPException(404, "Aluno não encontrado. Faça o cadastro primeiro.")

    access_mode = _access_mode_from_enrollment(enrollment)
    if access_mode == "expired_trial":
        raise HTTPException(status_code=403, detail=_trial_expired_detail())

    step_result = await db.execute(
        text(
            """
            SELECT s.id, m.tier, m.slug AS module_slug
            FROM playbook_steps s
            JOIN playbook_modules m ON m.id = s.module_id
            WHERE s.id = CAST(:sid AS uuid)
              AND s.is_published = true
              AND m.is_published = true
            LIMIT 1
            """
        ),
        {"sid": data.step_id},
    )
    step_row = step_result.mappings().first()
    if not step_row:
        raise HTTPException(404, "Passo nao encontrado")
    if _is_hidden_module_slug(step_row["module_slug"]):
        raise HTTPException(404, "Passo nao encontrado")

    if step_row["tier"] == "pro" and not _has_active_content_access(enrollment):
        raise HTTPException(
            status_code=403,
            detail={"code": "content_locked", "message": "Conteudo PRO disponivel apenas para membros ativos."},
        )

    await db.execute(
        text("""
            INSERT INTO playbook_progress (enrollment_id, step_id)
            VALUES (CAST(:eid AS uuid), CAST(:sid AS uuid))
            ON CONFLICT (enrollment_id, step_id) DO NOTHING
        """),
        {"eid": str(enrollment["id"]), "sid": data.step_id}
    )
    await db.commit()
    return {"ok": True}


@router.get("/progress/{phone}")
async def get_progress(phone: str, db: AsyncSession = Depends(get_db)):
    """Get student enrollment + progress summary."""
    normalized_phone = _normalize_phone(phone)

    result = await db.execute(
        text(f"""
            SELECT e.*,
                (SELECT COUNT(*)
                 FROM playbook_progress pp
                 JOIN playbook_steps s ON s.id = pp.step_id
                 JOIN playbook_modules m ON m.id = s.module_id
                 WHERE pp.enrollment_id = e.id
                   AND s.is_published = true
                   AND m.is_published = true
                   AND m.slug NOT IN ({HIDDEN_MODULE_SLUGS_SQL})
                   AND (m.tier = 'free' OR m.tier = e.tier)
                ) AS completed_steps,
                (SELECT COUNT(*) FROM playbook_steps s
                 JOIN playbook_modules m ON m.id = s.module_id
                 WHERE s.is_published = true AND m.is_published = true
                 AND m.slug NOT IN ({HIDDEN_MODULE_SLUGS_SQL})
                 AND (m.tier = 'free' OR m.tier = e.tier)
                ) AS total_steps
            FROM playbook_enrollments e
            WHERE e.phone = :phone
        """),
        {"phone": normalized_phone}
    )
    row = result.mappings().first()
    if not row:
        raise HTTPException(404, "Aluno não encontrado")

    access_mode = _access_mode_from_enrollment(row)
    if access_mode == "expired_trial":
        raise HTTPException(status_code=403, detail=_trial_expired_detail())

    return EnrollOut(
        id=str(row["id"]), phone=row["phone"], name=row["name"],
        email=row["email"], tier=row["tier"],
        enrolled_at=row["enrolled_at"].isoformat(),
        expires_at=row["expires_at"].isoformat() if row["expires_at"] else None,
        payment_method=row["payment_method"],
        access_mode=access_mode,
        completed_steps=row["completed_steps"],
        total_steps=row["total_steps"]
    )


@router.get("/leaderboard")
async def get_leaderboard(db: AsyncSession = Depends(get_db)):
    """Top members ranked by completed steps."""
    result = await db.execute(text(f"""
        SELECT e.name, e.tier, e.phone,
               COUNT(pp.id) FILTER (
                   WHERE s.is_published = true
                     AND m.is_published = true
                     AND m.slug NOT IN ({HIDDEN_MODULE_SLUGS_SQL})
               ) AS completed_steps,
               e.enrolled_at
        FROM playbook_enrollments e
        LEFT JOIN playbook_progress pp ON pp.enrollment_id = e.id
        LEFT JOIN playbook_steps s ON s.id = pp.step_id
        LEFT JOIN playbook_modules m ON m.id = s.module_id
        GROUP BY e.id
        ORDER BY completed_steps DESC, e.enrolled_at ASC
        LIMIT 20
    """))
    rows = result.mappings().all()
    leaders = []
    for i, r in enumerate(rows):
        phone = r["phone"] or ""
        masked = phone[:3] + "****" + phone[-2:] if len(phone) > 5 else "***"
        leaders.append({
            "rank": i + 1,
            "name": r["name"] or "Membro",
            "phone_masked": masked,
            "tier": r["tier"],
            "completed_steps": int(r["completed_steps"]),
        })
    return leaders


# ── Admin Routes (Diego) ────────────────────────────

@router.get("/admin/modules")
async def admin_list_modules(db: AsyncSession = Depends(get_db)):
    """List all modules including unpublished."""
    result = await db.execute(text("""
        SELECT m.*, COUNT(s.id) AS step_count
        FROM playbook_modules m
        LEFT JOIN playbook_steps s ON s.module_id = m.id
        GROUP BY m.id ORDER BY m.order_num
    """))
    return [dict(r) for r in result.mappings().all()]


@router.post("/admin/modules")
async def admin_create_module(data: ModuleAdmin, db: AsyncSession = Depends(get_db)):
    """Create a new module."""
    result = await db.execute(
        text("""
            INSERT INTO playbook_modules (slug, title, description, tier, icon, order_num, is_published)
            VALUES (:slug, :title, :description, :tier, :icon, :order_num, :is_published)
            RETURNING *
        """),
        data.model_dump()
    )
    await db.commit()
    return dict(result.mappings().first())


@router.put("/admin/modules/{module_id}")
async def admin_update_module(module_id: str, data: ModuleAdmin, db: AsyncSession = Depends(get_db)):
    """Update a module."""
    result = await db.execute(
        text("""
            UPDATE playbook_modules
            SET slug=:slug, title=:title, description=:description, tier=:tier,
                icon=:icon, order_num=:order_num, is_published=:is_published, updated_at=NOW()
            WHERE id = CAST(:id AS uuid) RETURNING *
        """),
        {**data.model_dump(), "id": module_id}
    )
    await db.commit()
    row = result.mappings().first()
    if not row:
        raise HTTPException(404, "Módulo não encontrado")
    return dict(row)


@router.post("/admin/modules/{module_id}/steps")
async def admin_create_step(module_id: str, data: StepAdmin, db: AsyncSession = Depends(get_db)):
    """Create a step in a module."""
    result = await db.execute(
        text("""
            INSERT INTO playbook_steps (module_id, slug, title, content, step_type, order_num, duration_min, code_snippet, is_published)
            VALUES (CAST(:module_id AS uuid), :slug, :title, :content, :step_type, :order_num, :duration_min, :code_snippet, :is_published)
            RETURNING *
        """),
        {**data.model_dump(), "module_id": module_id}
    )
    await db.commit()
    return dict(result.mappings().first())


@router.put("/admin/steps/{step_id}")
async def admin_update_step(step_id: str, data: StepAdmin, db: AsyncSession = Depends(get_db)):
    """Update a step."""
    result = await db.execute(
        text("""
            UPDATE playbook_steps
            SET slug=:slug, title=:title, content=:content, step_type=:step_type,
                order_num=:order_num, duration_min=:duration_min, code_snippet=:code_snippet,
                is_published=:is_published, updated_at=NOW()
            WHERE id = CAST(:id AS uuid) RETURNING *
        """),
        {**data.model_dump(), "id": step_id}
    )
    await db.commit()
    row = result.mappings().first()
    if not row:
        raise HTTPException(404, "Passo não encontrado")
    return dict(row)


@router.delete("/admin/steps/{step_id}")
async def admin_delete_step(step_id: str, db: AsyncSession = Depends(get_db)):
    """Delete a step."""
    await db.execute(
        text("DELETE FROM playbook_steps WHERE id = CAST(:id AS uuid)"),
        {"id": step_id}
    )
    await db.commit()
    return {"ok": True}


@router.get("/admin/enrollments")
async def admin_list_enrollments(
    status: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """List all enrolled students with progress."""
    result = await db.execute(text(f"""
        SELECT e.*,
            (SELECT COUNT(*)
             FROM playbook_progress pp
             JOIN playbook_steps s ON s.id = pp.step_id
             JOIN playbook_modules m ON m.id = s.module_id
             WHERE pp.enrollment_id = e.id
               AND s.is_published = true
               AND m.is_published = true
               AND m.slug NOT IN ({HIDDEN_MODULE_SLUGS_SQL})
            ) AS completed_steps
        FROM playbook_enrollments e
        ORDER BY e.enrolled_at DESC
    """))
    if status and status not in {"pending_manual", "expired_trial", "paid_manual"}:
        raise HTTPException(400, "Status invalido")

    items = []
    for row in result.mappings().all():
        access_mode = _access_mode_from_enrollment(row)
        if status == "pending_manual" and access_mode != "manual_trial":
            continue
        if status == "expired_trial" and access_mode != "expired_trial":
            continue
        if status == "paid_manual" and access_mode != "paid_manual":
            continue

        payload = dict(row)
        payload["id"] = str(payload["id"])
        payload["completed_steps"] = int(payload["completed_steps"] or 0)
        payload["enrolled_at"] = payload["enrolled_at"].isoformat() if payload["enrolled_at"] else None
        payload["expires_at"] = payload["expires_at"].isoformat() if payload.get("expires_at") else None
        payload["access_mode"] = access_mode
        items.append(payload)

    return items


@router.put("/admin/enrollments/{enrollment_id}/tier")
async def admin_update_tier(enrollment_id: str, tier: str = Query(...), db: AsyncSession = Depends(get_db)):
    """Upgrade/downgrade student tier."""
    await db.execute(
        text(
            """
            UPDATE playbook_enrollments
            SET tier = :tier, updated_at = NOW()
            WHERE id = CAST(:id AS uuid)
            """
        ),
        {"tier": tier, "id": enrollment_id}
    )
    await db.commit()
    return {"ok": True}


@router.post("/admin/enrollments/{enrollment_id}/approve-manual-payment")
async def approve_manual_payment(enrollment_id: str, db: AsyncSession = Depends(get_db)):
    """Approve a manual WhatsApp payment and convert trial access into permanent access."""
    result = await db.execute(
        text(
            """
            UPDATE playbook_enrollments
            SET tier = 'pro',
                is_active = true,
                expires_at = NULL,
                payment_method = :payment_method,
                notes = CASE
                    WHEN COALESCE(notes, '') = '' THEN :note
                    ELSE notes || E'\n' || :note
                END
            WHERE id = CAST(:id AS uuid)
            RETURNING id, phone, tier, payment_method
            """
        ),
        {
            "id": enrollment_id,
            "payment_method": MANUAL_PAID_PAYMENT_METHOD,
            "note": f"[manual_payment_approved {datetime.now(timezone.utc).isoformat()}]",
        },
    )
    row = result.mappings().first()
    await db.commit()
    if not row:
        raise HTTPException(404, "Enrollment nao encontrado")

    return {
        "id": str(row["id"]),
        "phone": row["phone"],
        "tier": row["tier"],
        "payment_method": row["payment_method"],
        "access_mode": "paid_manual",
        "status": "approved",
    }


@router.post("/admin/seed")
async def admin_seed_content(db: AsyncSession = Depends(get_db)):
    """Seed initial playbook content (modules + steps)."""
    modules = [
        {"slug": "fundacao", "title": "Fundação — CTO Virtual", "description": "Configure o Claude Code como seu CTO virtual em minutos. CLAUDE.md, memória persistente e análise de impacto.", "tier": "free", "icon": "🏗️", "order_num": 1},
        {"slug": "projetos", "title": "Gerenciamento de Projetos", "description": "Backlog inteligente, pipeline CI local e visão geral do projeto com /status.", "tier": "free", "icon": "📋", "order_num": 2},
        {"slug": "whatsapp", "title": "WhatsApp Integrado", "description": "Controle total do WhatsApp via Evolution API direto no terminal.", "tier": "pro", "icon": "💬", "order_num": 3},
        {"slug": "propostas", "title": "Propostas Comerciais", "description": "Gere propostas profissionais automaticamente com dados do CRM.", "tier": "pro", "icon": "📄", "order_num": 4},
        {"slug": "orchestrator", "title": "Pipeline Multi-Agente", "description": "Orquestrador autônomo: Seed Gate → Implementação → Testes → Code Review.", "tier": "pro", "icon": "🤖", "order_num": 5},
        {"slug": "youtube", "title": "YouTube Analytics", "description": "Tendências, briefings e produção de conteúdo para seu canal.", "tier": "pro", "icon": "🎬", "order_num": 6},
        {"slug": "deploy", "title": "Deploy Automatizado", "description": "EasyPanel + Docker + GitHub Actions direto do Claude Code.", "tier": "pro", "icon": "🚀", "order_num": 7},
        {"slug": "comunidade", "title": "Comunidade + IA", "description": "Rede social com RAG, bot assistente e base de conhecimento coletivo.", "tier": "pro", "icon": "🧠", "order_num": 8},
    ]

    steps_data = {
        "fundacao": [
            {"slug": "o-que-e", "title": "O que é um CTO Virtual?", "order_num": 1, "step_type": "theory", "duration_min": 3, "content": """
# O que é um CTO Virtual?

Um CTO Virtual é uma **camada de inteligência** sobre o Claude Code que transforma ele de um assistente genérico em um parceiro estratégico que:

- **Conhece seu negócio** — sabe quem são seus clientes, seus projetos, suas prioridades
- **Lembra de tudo** — memória persistente entre sessões via hooks e CLAUDE.md
- **Analisa antes de agir** — regra de ouro: análise de impacto obrigatória antes de qualquer mudança
- **Toma decisões técnicas** — prioriza por receita, classifica riscos, delega tarefas

## Por que isso importa?

Todo desenvolvedor solo enfrenta o mesmo problema: quando você está no código, perde a visão estratégica. Quando está planejando, o código para. E quando um cliente manda mensagem, tudo trava.

O CTO Virtual resolve isso criando uma **estrutura que pensa por você**.

> "Não é um framework. Não é uma lib. É uma configuração inteligente que você aplica em qualquer projeto."
"""},
            {"slug": "claude-md", "title": "CLAUDE.md — O Cérebro", "order_num": 2, "step_type": "practice", "duration_min": 5, "content": """
# CLAUDE.md — O Cérebro do seu CTO

O arquivo `CLAUDE.md` na raiz do seu projeto é o que o Claude Code lê **automaticamente** ao iniciar. É aqui que você define:

1. **Identidade** — Quem é o assistente, quem é o dono
2. **Projetos** — O que você está construindo
3. **Regras** — Como ele deve se comportar
4. **Convenções** — Padrões de código e processo

## Estrutura recomendada

```markdown
# NomeAssistente — CTO Virtual

## Identidade
Você é o NomeAssistente, CTO virtual do SeuNome.
Administra TODOS os projetos. Toma decisões técnicas.

## Dono
SeuNome — SeuNegocio

## REGRA DE OURO: ANÁLISE DE IMPACTO
ANTES de qualquer mudança, SEMPRE analisar:
1. Quais arquivos serão modificados?
2. Quais dependem desses arquivos?
3. Classificar risco: BAIXO / MÉDIO / ALTO

## Convenções
- Commits: feat:|fix:|chore:|docs:|refactor:
- NUNCA commitar .env, tokens, secrets
- Testar antes de push
```

## Crie o seu agora

Abra o Claude Code no seu projeto e cole o prompt abaixo:
""", "code_snippet": "Crie um arquivo CLAUDE.md na raiz deste projeto com:\n- Identidade: {nome} como CTO virtual\n- Regra de ouro: análise de impacto antes de qualquer mudança\n- Convenções: commits semânticos, nunca commitar secrets\n- Meu negócio: {negocio}"},
            {"slug": "hooks-basicos", "title": "Hooks — Automação Invisível", "order_num": 3, "step_type": "practice", "duration_min": 5, "content": """
# Hooks — Automação que Roda Sozinha

Hooks são scripts que o Claude Code executa **automaticamente** em eventos específicos. São o que transformam o assistente de reativo em **proativo**.

## Os 3 Hooks Essenciais

### 1. Session Start (ao abrir o Claude)
Carrega contexto automaticamente: git status, backlog, último briefing.

```bash
#!/bin/bash
# .claude/hooks/session-start.sh
echo "=== SESSÃO INICIADA ==="
echo "Data: $(date)"
echo "Branch: $(git branch --show-current 2>/dev/null)"
echo "Status: $(git status --short 2>/dev/null | head -5)"
```

### 2. Session Summary (ao fechar)
Salva um resumo do que foi feito na sessão.

### 3. Detect Credentials (antes de cada commit)
Escaneia arquivos modificados buscando API keys, tokens e senhas vazadas.

## Como funciona?

Os hooks ficam em `.claude/hooks/` e são configurados em `.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [{ "command": "bash .claude/hooks/session-start.sh" }],
    "PreToolUse": [{ "command": "bash .claude/hooks/detect-credentials.sh" }]
  }
}
```

## Configure agora

Use o setup.mjs ou cole o prompt único para criar os hooks automaticamente.
"""},
            {"slug": "impacto", "title": "Análise de Impacto", "order_num": 4, "step_type": "theory", "duration_min": 4, "content": """
# Análise de Impacto — A Regra de Ouro

A análise de impacto é o que separa um assistente de código de um **CTO virtual**. Antes de qualquer mudança, o sistema analisa:

| Área | O que verifica |
|------|---------------|
| **Backend** | Rotas, controllers, middleware, serviços afetados |
| **Frontend** | Componentes, páginas, estado, estilos |
| **Banco** | Schemas, migrations, queries, dados existentes |
| **Testes** | Quais quebram, quais criar |
| **Config** | Env vars, package.json, Docker, CI/CD |

## Classificação de Risco

- **BAIXO**: Isolada, sem dependências cruzadas → executa
- **MÉDIO**: Múltiplos arquivos, testes cobrindo → executa + notifica
- **ALTO**: Módulos críticos, sem testes, banco de dados → **aguarda aprovação**

## Na prática

Quando você pede uma mudança, o CTO virtual responde:

```
Mudança: Adicionar campo "role" na tabela users

┌──────────┬────────────────────┬───────┬──────────────────┐
│ Área     │ Impacto            │ Risco │ Ação             │
├──────────┼────────────────────┼───────┼──────────────────┤
│ Banco    │ ALTER TABLE users  │ ALTO  │ Aguardar aprovação│
│ Backend  │ 3 rotas afetadas   │ MÉDIO │ Atualizar testes │
│ Frontend │ 2 componentes      │ BAIXO │ Executar         │
└──────────┴────────────────────┴───────┴──────────────────┘

⚠️  RISCO ALTO: Migration detectada. Aguardando aprovação.
```

Use `/impacto` a qualquer momento para acionar manualmente.
"""},
        ],
        "projetos": [
            {"slug": "backlog", "title": "Backlog Inteligente", "order_num": 1, "step_type": "practice", "duration_min": 3, "content": """
# Backlog Inteligente

O `/backlog` é seu gerenciador de tarefas integrado ao Claude Code. Diferente de Jira ou Trello, ele vive **dentro do seu repositório** como um arquivo Markdown.

## Estrutura

```markdown
# Backlog

## ALTA (Prioridade — Receita/Urgente)
- [ ] Deploy do módulo de pagamentos
- [ ] Fix: login quebrando em mobile

## MÉDIA (Produtividade)
- [ ] Adicionar testes E2E
- [ ] Refatorar middleware de auth

## BAIXA (Nice-to-have)
- [ ] Dark mode
- [ ] Documentar API

## Em Andamento
- [ ] [JARBAS] Implementando cache Redis

## Concluídas
- [x] Setup CI/CD pipeline
```

## Regras de Priorização

| Prioridade | Critério | Exemplo |
|------------|----------|---------|
| **ALTA** | Gera receita ou é urgente | Bug em produção, feature de cliente |
| **MÉDIA** | Melhora produtividade | Testes, refactoring, DX |
| **BAIXA** | Nice-to-have | Docs, melhorias visuais |

## Use agora

Diga `/backlog` no Claude Code para ver e gerenciar suas tarefas.
"""},
            {"slug": "ci-local", "title": "CI Pipeline Local", "order_num": 2, "step_type": "practice", "duration_min": 3, "content": """
# CI Pipeline Local

O `/ci` roda um pipeline de qualidade **local** antes de você fazer push. Detecta automaticamente a stack do projeto.

## O que roda

```
── Pipeline CI Local ──────────────────────
  1/4 Lint................ ✅ PASS (0 warnings)
  2/4 TypeCheck........... ✅ PASS (0 errors)
  3/4 Testes.............. ✅ PASS (47/47, 3.2s)
  4/4 Secrets Scan........ ✅ PASS (0 segredos)

── Resultado: PASS ────────────────────────
  Seguro para commit.
```

## Detecção automática

| Stack detectada | Lint | Types | Testes |
|----------------|------|-------|--------|
| **Next.js/React** | eslint | tsc --noEmit | jest/vitest |
| **Node.js** | eslint | - | jest/mocha |
| **Python** | ruff/flake8 | mypy | pytest |
| **Go** | golint | go vet | go test |

## Secrets Scan

Busca por padrões perigosos nos arquivos staged:
- API keys (`sk-`, `key-`, `token-`)
- Passwords em strings
- URLs com credenciais

Use `/ci` antes de cada commit para garantir qualidade.
"""},
            {"slug": "status", "title": "Visão Geral com /status", "order_num": 3, "step_type": "theory", "duration_min": 2, "content": """
# Visão Geral com /status

O comando `/status` te dá um snapshot completo do estado do projeto em segundos:

```
┌─────────────────────────────────────────────────────────┐
│ STATUS — meu-saas (Next.js 16 + PostgreSQL)             │
├──────────────────────────────────────────────────────────┤
│ Branch: main (clean) ✅                                  │
│                                                          │
│ Últimos commits:                                         │
│   f8a2c1d feat: add payment webhook     (2h ago)         │
│   b3e5d7f fix: login redirect loop      (5h ago)         │
│                                                          │
│ Backlog: 3 ALTA | 5 MÉDIA | 2 BAIXA                     │
│ Testes: 47/47 ✅                                         │
└──────────────────────────────────────────────────────────┘
```

Inclui: branch atual, commits recentes, contagem do backlog e status dos testes.

É o primeiro comando do seu dia — abre o Claude, diz "bom dia", e o CTO virtual te dá o briefing.
"""},
        ],
    }

    modules = [module for module in modules if module["slug"] not in HIDDEN_MODULE_SLUGS]

    # Insert modules
    for m in modules:
        await db.execute(
            text("""
                INSERT INTO playbook_modules (slug, title, description, tier, icon, order_num, is_published)
                VALUES (:slug, :title, :description, :tier, :icon, :order_num, true)
                ON CONFLICT (slug) DO UPDATE SET title=:title, description=:description, tier=:tier,
                    icon=:icon, order_num=:order_num, is_published=true, updated_at=NOW()
            """),
            m
        )

    # Insert steps
    for module_slug, steps in steps_data.items():
        if module_slug in HIDDEN_MODULE_SLUGS:
            continue
        mod_result = await db.execute(
            text("SELECT id FROM playbook_modules WHERE slug = :slug"),
            {"slug": module_slug}
        )
        mod = mod_result.mappings().first()
        if mod:
            for s in steps:
                await db.execute(
                    text("""
                        INSERT INTO playbook_steps (module_id, slug, title, content, step_type, order_num, duration_min, code_snippet, is_published)
                        VALUES (CAST(:module_id AS uuid), :slug, :title, :content, :step_type, :order_num, :duration_min, :code_snippet, true)
                        ON CONFLICT (module_id, slug) DO UPDATE SET title=:title, content=:content,
                            step_type=:step_type, order_num=:order_num, duration_min=:duration_min,
                            code_snippet=:code_snippet, is_published=true, updated_at=NOW()
                    """),
                    {**s, "module_id": str(mod["id"]), "code_snippet": s.get("code_snippet")}
                )

    await db.commit()
    return {
        "ok": True,
        "modules": len(modules),
        "steps": sum(len(steps) for module_slug, steps in steps_data.items() if module_slug not in HIDDEN_MODULE_SLUGS),
    }
