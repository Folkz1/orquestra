"""
Orquestra - Testing Router
"""
import secrets
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import TestPlan, TestResult, TestSession, Tester
from app.schemas import (
    TestPlanCreate,
    TestPlanResponse,
    TestResultCreate,
    TestResultResponse,
    TestSessionCreate,
    TestSessionPublic,
    TestSessionResponse,
    TesterCreate,
    TesterResponse,
)

router = APIRouter()


# ── Testers ──────────────────────────────────────────────────────────────────

@router.get("/testers", response_model=list[TesterResponse])
async def list_testers(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Tester).order_by(Tester.criado_em.desc()))
    return result.scalars().all()


@router.post("/testers", response_model=TesterResponse, status_code=201)
async def create_tester(data: TesterCreate, db: AsyncSession = Depends(get_db)):
    tester = Tester(**data.model_dump())
    db.add(tester)
    await db.flush()
    await db.refresh(tester)
    return tester


# ── Test Plans ────────────────────────────────────────────────────────────────

@router.get("/test-plans", response_model=list[TestPlanResponse])
async def list_test_plans(
    projeto: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    stmt = select(TestPlan).order_by(TestPlan.criado_em.desc())
    if projeto:
        stmt = stmt.where(TestPlan.projeto == projeto)
    result = await db.execute(stmt)
    return result.scalars().all()


@router.post("/test-plans", response_model=TestPlanResponse, status_code=201)
async def create_test_plan(data: TestPlanCreate, db: AsyncSession = Depends(get_db)):
    plan = TestPlan(**data.model_dump())
    db.add(plan)
    await db.flush()
    await db.refresh(plan)
    return plan


# ── Test Sessions ─────────────────────────────────────────────────────────────

@router.get("/test-sessions", response_model=list[TestSessionResponse])
async def list_test_sessions(
    projeto: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    stmt = (
        select(TestSession)
        .join(TestPlan, TestSession.plan_id == TestPlan.id)
        .order_by(TestSession.criado_em.desc())
    )
    if projeto:
        stmt = stmt.where(TestPlan.projeto == projeto)
    result = await db.execute(stmt)
    return result.scalars().all()


@router.post("/test-sessions", response_model=TestSessionResponse, status_code=201)
async def create_test_session(data: TestSessionCreate, db: AsyncSession = Depends(get_db)):
    plan = await db.get(TestPlan, data.plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="TestPlan não encontrado")

    session = TestSession(
        plan_id=data.plan_id,
        tester_id=data.tester_id,
        link_token=secrets.token_urlsafe(32),
        status="pendente",
    )
    db.add(session)
    await db.flush()
    await db.refresh(session)
    return session


@router.get("/test-sessions/by-token/{token}", response_model=TestSessionPublic)
async def get_session_by_token(token: str, db: AsyncSession = Depends(get_db)):
    """Endpoint público — usado pela testadora para carregar o formulário."""
    stmt = select(TestSession).where(TestSession.link_token == token)
    result = await db.execute(stmt)
    session = result.scalar_one_or_none()

    if not session:
        raise HTTPException(status_code=404, detail="Sessão não encontrada ou token inválido")

    if session.status == "pendente":
        session.status = "em_progresso"
        session.iniciado_em = datetime.now(timezone.utc)
        await db.flush()

    tester_nome = None
    if session.tester_id:
        tester = await db.get(Tester, session.tester_id)
        tester_nome = tester.nome if tester else None

    stmt_results = select(TestResult).where(TestResult.session_id == session.id)
    results_data = await db.execute(stmt_results)
    results = results_data.scalars().all()

    return TestSessionPublic(
        id=session.id,
        status=session.status,
        link_token=session.link_token,
        plan=session.plan,
        tester_nome=tester_nome,
        results=[TestResultResponse.model_validate(r) for r in results],
    )


@router.post("/test-sessions/{session_id}/results", response_model=TestResultResponse, status_code=201)
async def save_step_result(
    session_id: UUID,
    data: TestResultCreate,
    db: AsyncSession = Depends(get_db),
):
    """Salva resultado de um passo — chamado pela testadora."""
    session = await db.get(TestSession, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Sessão não encontrada")

    # Upsert: se já existe resultado para este step, atualiza
    stmt = select(TestResult).where(
        TestResult.session_id == session_id,
        TestResult.step_id == data.step_id,
    )
    existing = (await db.execute(stmt)).scalar_one_or_none()

    if existing:
        existing.status = data.status
        existing.comentario = data.comentario
        existing.screenshot_url = data.screenshot_url
        await db.flush()
        await db.refresh(existing)
        return existing

    result = TestResult(session_id=session_id, **data.model_dump())
    db.add(result)
    await db.flush()
    await db.refresh(result)
    return result


@router.post("/test-sessions/{session_id}/submit", response_model=TestSessionResponse)
async def submit_session(session_id: UUID, db: AsyncSession = Depends(get_db)):
    """Finaliza a sessão e dispara notificação WhatsApp para Diego."""
    session = await db.get(TestSession, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Sessão não encontrada")

    session.status = "concluido"
    session.concluido_em = datetime.now(timezone.utc)
    await db.flush()
    await db.refresh(session)

    # Dispara WhatsApp para Diego em background (fire and forget)
    try:
        await _notify_diego(session, db)
    except Exception:
        pass  # Não falha o submit se WhatsApp falhar

    return session


async def _notify_diego(session: TestSession, db: AsyncSession) -> None:
    """Envia resumo do teste para Diego via WhatsApp."""
    import os
    from app.services.whatsapp import send_whatsapp_message

    stmt = select(TestResult).where(TestResult.session_id == session.id)
    results = (await db.execute(stmt)).scalars().all()

    total = len(session.plan.steps) if session.plan and session.plan.steps else 0
    passou = sum(1 for r in results if r.status == "pass")
    falhou = [r for r in results if r.status == "fail"]

    lines = [
        f"{'✅' if not falhou else '⚠️'} Teste concluído — {session.plan.projeto} / {session.plan.nome}",
        f"Resultado: {passou}/{total} passos ok",
    ]

    if falhou:
        lines.append("\n❌ Problemas encontrados:")
        for r in falhou:
            step = next((s for s in session.plan.steps if s.get("id") == r.step_id), None)
            titulo = step.get("titulo", r.step_id) if step else r.step_id
            comentario = f": {r.comentario}" if r.comentario else ""
            lines.append(f"• {titulo}{comentario}")

    frontend_url = os.getenv("FRONTEND_URL", "https://guyyfolkz.mbest.site")
    lines.append(f"\nVer relatório: {frontend_url}/projetos?tab=testes&session={session.id}")

    message = "\n".join(lines)

    diego_whatsapp = os.getenv("DIEGO_WHATSAPP", "") or os.getenv("OWNER_WHATSAPP", "")
    if not diego_whatsapp:
        return

    await send_whatsapp_message(diego_whatsapp, message)
