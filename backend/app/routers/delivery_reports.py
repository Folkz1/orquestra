import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models import DeliveryReport, Proposal
from app.schemas import DeliveryReportResponse, DeliveryReportUpdate
from app.services.delivery_reports import generate_delivery_report, send_delivery_report_to_client

logger = logging.getLogger(__name__)

router = APIRouter()


def _serialize_report(report: DeliveryReport) -> DeliveryReportResponse:
    proposal = report.proposal
    contact = report.contact
    return DeliveryReportResponse(
        id=report.id,
        proposal_id=report.proposal_id,
        contact_id=report.contact_id,
        proposed_scope=list(report.proposed_scope or []),
        delivered_scope=list(report.delivered_scope or []),
        extras=list(report.extras or []),
        financial_summary=dict(report.financial_summary or {}),
        comparison_analysis=report.comparison_analysis,
        status=report.status,
        generated_at=report.generated_at,
        created_at=report.created_at,
        updated_at=report.updated_at,
        proposal_title=proposal.title if proposal else None,
        proposal_slug=proposal.slug if proposal else None,
        proposal_status=proposal.status if proposal else None,
        client_name=proposal.client_name if proposal else None,
        client_phone=proposal.client_phone if proposal else None,
        contact_name=(contact.name or contact.push_name) if contact else None,
    )


async def _get_proposal_or_404(db: AsyncSession, proposal_id: UUID) -> Proposal:
    stmt = select(Proposal).where(Proposal.id == proposal_id)
    result = await db.execute(stmt)
    proposal = result.scalar_one_or_none()
    if not proposal:
        raise HTTPException(status_code=404, detail="Proposal not found")
    return proposal


async def _get_report_by_proposal(db: AsyncSession, proposal_id: UUID) -> DeliveryReport | None:
    stmt = (
        select(DeliveryReport)
        .options(
            selectinload(DeliveryReport.proposal),
            selectinload(DeliveryReport.contact),
        )
        .where(DeliveryReport.proposal_id == proposal_id)
    )
    result = await db.execute(stmt)
    return result.scalar_one_or_none()


async def _get_report_or_404(db: AsyncSession, report_id: UUID) -> DeliveryReport:
    stmt = (
        select(DeliveryReport)
        .options(
            selectinload(DeliveryReport.proposal),
            selectinload(DeliveryReport.contact),
        )
        .where(DeliveryReport.id == report_id)
    )
    result = await db.execute(stmt)
    report = result.scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404, detail="Delivery report not found")
    return report


@router.get("/delivery-reports", response_model=list[DeliveryReportResponse])
async def list_delivery_reports(db: AsyncSession = Depends(get_db)):
    stmt = (
        select(DeliveryReport)
        .options(
            selectinload(DeliveryReport.proposal),
            selectinload(DeliveryReport.contact),
        )
        .order_by(DeliveryReport.updated_at.desc())
    )
    result = await db.execute(stmt)
    return [_serialize_report(report) for report in result.scalars().all()]


@router.get("/proposals/{proposal_id}/delivery-report", response_model=DeliveryReportResponse)
async def get_delivery_report(proposal_id: UUID, db: AsyncSession = Depends(get_db)):
    report = await _get_report_by_proposal(db, proposal_id)
    if not report:
        raise HTTPException(status_code=404, detail="Delivery report not found")
    return _serialize_report(report)


@router.post("/proposals/{proposal_id}/delivery-report", response_model=DeliveryReportResponse)
async def create_or_regenerate_delivery_report(
    proposal_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    proposal = await _get_proposal_or_404(db, proposal_id)
    report = await _get_report_by_proposal(db, proposal_id)

    try:
        report = await generate_delivery_report(db, proposal, report=report)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("[DELIVERY_REPORT] Generation failed for proposal %s", proposal_id)
        raise HTTPException(status_code=502, detail=f"Falha ao gerar delivery report: {exc}") from exc

    await db.commit()
    report = await _get_report_by_proposal(db, proposal_id)
    return _serialize_report(report)


@router.patch("/delivery-reports/{report_id}", response_model=DeliveryReportResponse)
async def update_delivery_report(
    report_id: UUID,
    data: DeliveryReportUpdate,
    db: AsyncSession = Depends(get_db),
):
    report = await _get_report_or_404(db, report_id)
    proposal = await _get_proposal_or_404(db, report.proposal_id)

    payload = data.model_dump(exclude_unset=True)
    send_to_client = bool(payload.pop("send_to_client", False))
    requested_status = payload.get("status")

    for field, value in payload.items():
        setattr(report, field, value)

    if send_to_client or requested_status == "sent_to_client":
        try:
            await send_delivery_report_to_client(db, report, proposal)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc
        report.status = "sent_to_client"

    await db.commit()
    report = await _get_report_or_404(db, report_id)
    return _serialize_report(report)
