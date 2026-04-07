"""
Orquestra - Pydantic v2 Schemas
Request/Response models for all endpoints.
"""

from datetime import date, datetime
from typing import Any, Generic, Optional, TypeVar
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


# ─── Generic Paginated Response ───────────────────────────────────────────

T = TypeVar("T")


class PaginatedResponse(BaseModel, Generic[T]):
    items: list[T]
    total: int
    page: int
    page_size: int
    total_pages: int


# ─── Contact Schemas ──────────────────────────────────────────────────────


class ContactBase(BaseModel):
    phone: str = Field(..., max_length=20)
    name: Optional[str] = Field(None, max_length=255)
    push_name: Optional[str] = Field(None, max_length=255)
    profile_pic_url: Optional[str] = None
    tags: list[str] = Field(default_factory=list)
    project_id: Optional[UUID] = None
    notes: Optional[str] = None
    is_group: bool = False
    ignored: bool = False
    pipeline_stage: str = Field(default="lead", max_length=30)
    company: Optional[str] = Field(None, max_length=255)
    email: Optional[str] = Field(None, max_length=255)


class ContactCreate(ContactBase):
    pass


class ContactUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=255)
    push_name: Optional[str] = Field(None, max_length=255)
    profile_pic_url: Optional[str] = None
    tags: Optional[list[str]] = None
    project_id: Optional[UUID] = None
    notes: Optional[str] = None
    is_group: Optional[bool] = None
    ignored: Optional[bool] = None
    pipeline_stage: Optional[str] = Field(None, max_length=30)
    company: Optional[str] = Field(None, max_length=255)
    email: Optional[str] = Field(None, max_length=255)
    engagement_score: Optional[int] = None
    next_action: Optional[str] = None
    next_action_date: Optional[date] = None
    monthly_revenue: Optional[str] = Field(None, max_length=50)
    total_revenue: Optional[str] = Field(None, max_length=50)
    support_ends_at: Optional[datetime] = None


class ContactResponse(ContactBase):
    id: UUID
    pipeline_stage: str = "lead"
    company: Optional[str] = None
    email: Optional[str] = None
    engagement_score: int = 0
    last_contacted_at: Optional[datetime] = None
    next_action: Optional[str] = None
    next_action_date: Optional[date] = None
    monthly_revenue: Optional[str] = None
    total_revenue: Optional[str] = None
    acquired_at: Optional[datetime] = None
    support_ends_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    message_count: int = 0
    unread_count: int = 0
    last_message_preview: Optional[str] = None
    last_message_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


# ─── Message Schemas ──────────────────────────────────────────────────────


class MessageBase(BaseModel):
    contact_id: UUID
    remote_jid: str = Field(..., max_length=100)
    direction: str = Field(..., max_length=10)
    message_type: str = Field(..., max_length=20)
    content: Optional[str] = None
    transcription: Optional[str] = None
    media_url: Optional[str] = None
    media_local_path: Optional[str] = None
    media_mimetype: Optional[str] = Field(None, max_length=100)
    media_duration_seconds: Optional[int] = None
    quoted_message_id: Optional[UUID] = None
    evolution_message_id: Optional[str] = Field(None, max_length=100)
    raw_payload: Optional[dict[str, Any]] = None
    processed: bool = False
    project_id: Optional[UUID] = None
    timestamp: datetime


class MessageResponse(MessageBase):
    id: UUID
    created_at: datetime
    contact_name: Optional[str] = None
    contact_phone: Optional[str] = None
    project_name: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


# ─── Recording Schemas ────────────────────────────────────────────────────


class RecordingBase(BaseModel):
    title: Optional[str] = Field(None, max_length=500)
    source: str = Field(default="pwa", max_length=20)
    file_path: str
    file_size_bytes: Optional[int] = None
    duration_seconds: Optional[int] = None
    project_id: Optional[UUID] = None


class RecordingCreate(RecordingBase):
    pass


class RecordingResponse(RecordingBase):
    id: UUID
    transcription: Optional[str] = None
    summary: Optional[str] = None
    action_items: list[Any] = Field(default_factory=list)
    decisions: list[Any] = Field(default_factory=list)
    key_topics: list[Any] = Field(default_factory=list)
    processed: bool = False
    project_name: Optional[str] = None
    recorded_at: datetime
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class RecordingLightResponse(RecordingBase):
    """Lightweight response that truncates transcription to avoid OOM on large payloads."""
    id: UUID
    transcription_preview: Optional[str] = Field(
        None, description="First 500 chars of the transcription"
    )
    transcription_length: int = Field(
        0, description="Total character count of the full transcription"
    )
    summary: Optional[str] = None
    action_items: list[Any] = Field(default_factory=list)
    decisions: list[Any] = Field(default_factory=list)
    key_topics: list[Any] = Field(default_factory=list)
    processed: bool = False
    project_name: Optional[str] = None
    recorded_at: datetime
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ─── Project Schemas ──────────────────────────────────────────────────────


class ProjectBase(BaseModel):
    name: str = Field(..., max_length=255)
    description: Optional[str] = None
    status: str = Field(default="active", max_length=20)
    color: str = Field(default="#3b82f6", max_length=7)
    keywords: list[str] = Field(default_factory=list)


class ProjectCreate(ProjectBase):
    credentials: dict[str, Any] = Field(default_factory=dict)


class ProjectUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=255)
    description: Optional[str] = None
    status: Optional[str] = Field(None, max_length=20)
    color: Optional[str] = Field(None, max_length=7)
    keywords: Optional[list[str]] = None
    credentials: Optional[dict[str, Any]] = None


class ProjectCredentialsUpdate(BaseModel):
    credentials: dict[str, Any] = Field(..., description="Full credentials object to set")


class ProjectStats(BaseModel):
    total_messages: int = 0
    total_recordings: int = 0
    last_activity: Optional[datetime] = None


class ProjectOptionResponse(BaseModel):
    id: UUID
    name: str
    status: str = "active"
    color: str = "#3b82f6"

    model_config = ConfigDict(from_attributes=True)


class ConversationListItem(BaseModel):
    contact_id: UUID
    contact_name: str
    contact_phone: str
    profile_pic_url: Optional[str] = None
    project_id: Optional[UUID] = None
    project_name: Optional[str] = None
    pipeline_stage: str = "lead"
    unread_count: int = 0
    message_count: int = 0
    last_message_preview: Optional[str] = None
    last_message_at: Optional[datetime] = None


class MessageSendRequest(BaseModel):
    contact_id: Optional[UUID] = None
    phone: Optional[str] = Field(None, max_length=20)
    content: str = Field(..., min_length=1, max_length=4000)


class MarkConversationReadResponse(BaseModel):
    contact_id: UUID
    unread_count: int = 0


class ProposalMini(BaseModel):
    id: UUID
    title: str
    status: str
    total_value: Optional[str] = None
    updated_at: datetime


class TaskMini(BaseModel):
    id: UUID
    title: str
    status: str
    priority: str
    updated_at: datetime


class DeliveryReportMini(BaseModel):
    id: UUID
    proposal_id: UUID
    status: str
    generated_at: datetime
    comparison_analysis: Optional[str] = None


class ChatContextResponse(BaseModel):
    contact: ContactResponse
    project_name: Optional[str] = None
    proposals: list[ProposalMini] = Field(default_factory=list)
    tasks: list[TaskMini] = Field(default_factory=list)
    delivery_reports: list[DeliveryReportMini] = Field(default_factory=list)


class ReplySuggestionResponse(BaseModel):
    suggestion: str


class PushSubscriptionCreate(BaseModel):
    endpoint: str
    p256dh: str
    auth: str
    user_agent: Optional[str] = None


class PushSubscriptionResponse(BaseModel):
    id: UUID
    endpoint: str
    created_at: datetime
    updated_at: datetime
    last_seen_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ProjectResponse(ProjectBase):
    id: UUID
    credentials: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime
    stats: ProjectStats = Field(default_factory=ProjectStats)

    model_config = ConfigDict(from_attributes=True)


# ─── Daily Brief Schemas ──────────────────────────────────────────────────


class DailyBriefResponse(BaseModel):
    id: UUID
    date: date
    period_start: datetime
    period_end: datetime
    total_messages: int
    total_recordings: int
    summary: str
    pending_actions: list[dict[str, Any]] = Field(default_factory=list)
    decisions_made: list[dict[str, Any]] = Field(default_factory=list)
    key_insights: list[dict[str, Any]] = Field(default_factory=list)
    projects_mentioned: list[str] = Field(default_factory=list)
    raw_context: Optional[str] = None
    model_used: Optional[str] = None
    sent_telegram: bool = False
    sent_whatsapp: bool = False
    generated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class BriefGenerateRequest(BaseModel):
    date_from: Optional[datetime] = None
    date_to: Optional[datetime] = None
    send_telegram: bool = True


# ─── Memory Schemas ──────────────────────────────────────────────────────


class MemoryIngestRequest(BaseModel):
    content: str = Field(..., min_length=1, description="Text content to store")
    source_type: str = Field(
        default="message", max_length=20, description="Source type: message, recording, youtube"
    )
    source_id: Optional[str] = Field(None, description="UUID of the source record")
    contact_name: Optional[str] = Field(None, max_length=255)
    project_name: Optional[str] = Field(None, max_length=255)
    metadata: Optional[dict[str, Any]] = None
    summary: Optional[str] = None


class MemorySearchResult(BaseModel):
    id: str
    source_type: str
    source_id: Optional[str] = None
    content: str
    summary: Optional[str] = None
    contact_name: Optional[str] = None
    project_name: Optional[str] = None
    metadata: Optional[dict[str, Any]] = None
    created_at: Optional[str] = None
    similarity: float = 0.0


class MemorySearchResponse(BaseModel):
    query: str
    results: list[MemorySearchResult]
    total: int


class MemoryStatsResponse(BaseModel):
    by_source: dict[str, int] = Field(default_factory=dict)
    total: int = 0


# ─── YouTube Schemas ─────────────────────────────────────────────────────


class YouTubeUploadRequest(BaseModel):
    title: str
    description: str = ""
    tags: list[str] = Field(default_factory=list)
    category_id: str = "28"
    privacy_status: str = "private"
    project_name: str = "GuyFolkz"


class YouTubeUploadUrlRequest(YouTubeUploadRequest):
    source_url: str
    thumbnail_url: Optional[str] = None


class YouTubeUploadResponse(BaseModel):
    status: str
    video_id: str
    url: str
    privacy_status: str


class YouTubeVideoUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    tags: Optional[list[str]] = None
    privacy_status: Optional[str] = None


class YouTubeScheduleRequest(BaseModel):
    publish_at: str


class YouTubeChannelStats(BaseModel):
    subscribers: int
    total_views: int
    total_videos: int
    recent_videos: list[dict[str, Any]] = Field(default_factory=list)


class YouTubeVideoDetail(BaseModel):
    video_id: str
    title: str
    views: int
    likes: int
    comments: int
    published_at: str
    privacy_status: str
    thumbnail_url: str


class YouTubeAnalyzeRequest(BaseModel):
    topics: Optional[list[str]] = Field(
        default=None,
        description="Topics to analyze (default: IA, automacao, licitacoes)",
    )
    sources: Optional[list[str]] = Field(
        default=None,
        description="Sources to consider (default: reddit, youtube, news)",
    )


class YouTubeAnalyzeResponse(BaseModel):
    trends: list[dict[str, Any]] = Field(default_factory=list)
    video_ideas: list[dict[str, Any]] = Field(default_factory=list)
    market_insights: list[Any] = Field(default_factory=list)


class YouTubeSendBriefRequest(BaseModel):
    phone: str = Field(
        default="5195318541", description="WhatsApp phone number"
    )
    topics: Optional[list[str]] = Field(
        default=None,
        description="Topics to analyze",
    )
    sources: Optional[list[str]] = Field(
        default=None,
        description="Sources to consider",
    )


# ─── Scheduled Message Schemas ───────────────────────────────────────────


class ScheduledMessageCreate(BaseModel):
    phone: str = Field(..., max_length=20, description="Phone with country code, e.g. 554185126488")
    message_text: str = Field(..., min_length=1, description="Message text to send")
    scheduled_for: datetime = Field(..., description="When to send (ISO 8601 with timezone)")
    evolution_instance: Optional[str] = Field(None, max_length=100, description="Evolution instance name")
    contact_id: Optional[UUID] = None
    project_id: Optional[UUID] = None
    metadata_json: dict[str, Any] = Field(default_factory=dict)


class ScheduledMessageUpdate(BaseModel):
    message_text: Optional[str] = None
    scheduled_for: Optional[datetime] = None
    status: Optional[str] = Field(None, pattern=r"^(pending|cancelled)$")
    evolution_instance: Optional[str] = None
    metadata_json: Optional[dict[str, Any]] = None


class ScheduledMessageResponse(BaseModel):
    id: UUID
    phone: str
    message_text: str
    scheduled_for: datetime
    status: str
    error_message: Optional[str] = None
    evolution_instance: Optional[str] = None
    contact_id: Optional[UUID] = None
    project_id: Optional[UUID] = None
    metadata_json: dict[str, Any] = Field(default_factory=dict)
    sent_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    contact_name: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class WhatsAppSendRequest(BaseModel):
    phone: str = Field(..., description="Phone number with country code")
    message: str = Field(..., description="Message text to send")
    instance: Optional[str] = Field(None, description="Evolution API instance name")


# ─── Task Schemas ────────────────────────────────────────────────────────


class TaskCreate(BaseModel):
    project_id: Optional[UUID] = None
    title: str = Field(..., min_length=1, max_length=500)
    description: Optional[str] = None
    status: str = Field(default="backlog", pattern="^(backlog|in_progress|review|done)$")
    priority: str = Field(default="medium", pattern="^(high|medium|low)$")
    source: str = Field(default="manual", pattern="^(manual|backlog|auto)$")
    assigned_to: str = Field(default="claude", pattern="^(claude|diego)$")
    metadata_json: dict[str, Any] = Field(default_factory=dict)


class TaskUpdate(BaseModel):
    project_id: Optional[UUID] = None
    title: Optional[str] = Field(None, min_length=1, max_length=500)
    description: Optional[str] = None
    status: Optional[str] = Field(None, pattern="^(backlog|in_progress|review|done)$")
    priority: Optional[str] = Field(None, pattern="^(high|medium|low)$")
    assigned_to: Optional[str] = Field(None, pattern="^(claude|diego)$")
    metadata_json: Optional[dict[str, Any]] = None


class TaskResponse(BaseModel):
    id: UUID
    project_id: Optional[UUID] = None
    project_name: Optional[str] = None
    project_color: Optional[str] = None
    title: str
    description: Optional[str] = None
    status: str
    priority: str
    source: str
    assigned_to: str
    metadata_json: dict[str, Any] = Field(default_factory=dict)
    project_credentials: dict[str, Any] = Field(default_factory=dict)
    completed_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AutoResearchDecisionRequest(BaseModel):
    decision: str = Field(
        ...,
        pattern="^(pending|approved|rejected|needs_client_confirmation)$",
    )
    note: Optional[str] = None
    approval_checklist: Optional[list[dict[str, Any]]] = None
    client_checklist: Optional[list[dict[str, Any]]] = None
    client_confirmation_status: Optional[str] = Field(
        None,
        pattern="^(not_needed|pending|confirmed)$",
    )


class AutoResearchApplyResultRequest(BaseModel):
    apply_status: str = Field(..., pattern="^(applied|apply_failed)$")
    note: Optional[str] = None
    error: Optional[str] = None
    applied_files: list[str] = Field(default_factory=list)


# ─── Proposal Schemas ───────────────────────────────────────────────────


class ProposalCreate(BaseModel):
    slug: str = Field(..., max_length=255, pattern=r"^[a-z0-9-]+$")
    title: str = Field(..., max_length=500)
    client_name: str = Field(..., max_length=255)
    client_phone: Optional[str] = Field(None, max_length=20)
    contact_id: Optional[UUID] = None
    content: str = Field(..., min_length=1)
    status: str = Field(default="draft", pattern=r"^(draft|sent|viewed|accepted|rejected)$")
    total_value: Optional[str] = Field(None, max_length=50)
    metadata_json: dict[str, Any] = Field(default_factory=dict)


class ProposalUpdate(BaseModel):
    title: Optional[str] = Field(None, max_length=500)
    client_name: Optional[str] = Field(None, max_length=255)
    client_phone: Optional[str] = Field(None, max_length=20)
    content: Optional[str] = None
    status: Optional[str] = Field(None, pattern=r"^(draft|sent|viewed|accepted|rejected)$")
    total_value: Optional[str] = Field(None, max_length=50)
    metadata_json: Optional[dict[str, Any]] = None


class ProposalResponse(BaseModel):
    id: UUID
    slug: str
    title: str
    client_name: str
    client_phone: Optional[str] = None
    contact_id: Optional[UUID] = None
    content: str
    status: str
    total_value: Optional[str] = None
    metadata_json: dict[str, Any] = Field(default_factory=dict)
    viewed_at: Optional[datetime] = None
    accepted_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ProposalCommentCreate(BaseModel):
    author_name: str = Field(..., min_length=1, max_length=255)
    content: str = Field(..., min_length=1)
    highlighted_text: Optional[str] = None


class ProposalCommentResponse(BaseModel):
    id: UUID
    author_name: str
    content: str
    highlighted_text: Optional[str] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ProposalPublicResponse(BaseModel):
    title: str
    client_name: str
    content: str
    total_value: Optional[str] = None
    comments: list[ProposalCommentResponse] = Field(default_factory=list)
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ProposalEventCreate(BaseModel):
    session_id: str = Field(..., max_length=100)
    event_type: str = Field(..., max_length=30, pattern=r"^(page_view|scroll_depth|time_on_page|annotation|download_pdf|section_view)$")
    event_data: dict[str, Any] = Field(default_factory=dict)


class ProposalEventResponse(BaseModel):
    id: UUID
    proposal_id: UUID
    session_id: str
    event_type: str
    event_data: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ProposalAnalyticsSummary(BaseModel):
    total_views: int = 0
    unique_sessions: int = 0
    total_time_seconds: int = 0
    max_scroll_pct: int = 0
    total_annotations: int = 0
    total_downloads: int = 0
    sections_viewed: list[str] = Field(default_factory=list)
    first_view: Optional[datetime] = None
    last_view: Optional[datetime] = None
    events: list[ProposalEventResponse] = Field(default_factory=list)


# ─── Delivery Report Schemas ────────────────────────────────────────────────


class DeliveryReportUpdate(BaseModel):
    proposed_scope: Optional[list[dict[str, Any]]] = None
    delivered_scope: Optional[list[dict[str, Any]]] = None
    extras: Optional[list[dict[str, Any]]] = None
    financial_summary: Optional[dict[str, Any]] = None
    comparison_analysis: Optional[str] = None
    status: Optional[str] = Field(None, pattern=r"^(draft|final|sent_to_client)$")
    send_to_client: bool = False


class DeliveryReportResponse(BaseModel):
    id: UUID
    proposal_id: UUID
    contact_id: Optional[UUID] = None
    proposed_scope: list[dict[str, Any]] = Field(default_factory=list)
    delivered_scope: list[dict[str, Any]] = Field(default_factory=list)
    extras: list[dict[str, Any]] = Field(default_factory=list)
    financial_summary: dict[str, Any] = Field(default_factory=dict)
    comparison_analysis: Optional[str] = None
    status: str
    generated_at: datetime
    created_at: datetime
    updated_at: datetime
    proposal_title: Optional[str] = None
    proposal_slug: Optional[str] = None
    proposal_status: Optional[str] = None
    client_name: Optional[str] = None
    client_phone: Optional[str] = None
    contact_name: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


# ─── Assistant Schemas ───────────────────────────────────────────────────

class AssistantDraftGenerateRequest(BaseModel):
    contact_id: Optional[UUID] = None
    phone: Optional[str] = Field(None, description="Contact phone with country code")
    objective: Optional[str] = Field(None, description="What this response should achieve")
    send_now: bool = False


class AssistantDraftResponse(BaseModel):
    id: UUID
    contact_id: UUID
    based_on_message_id: Optional[UUID] = None
    objective: Optional[str] = None
    draft_text: str
    status: str
    metadata_json: dict[str, Any] = Field(default_factory=dict)
    sent_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ─── Subscription Schemas ─────────────────────────────────────────────────

class SubscriptionCreate(BaseModel):
    client_name: str
    description: Optional[str] = None
    amount_cents: int = Field(..., description="Valor em centavos (ex: 40000 = R$400)")
    currency: str = "BRL"
    billing_day: int = Field(1, ge=1, le=28)
    contact_id: Optional[UUID] = None
    project_id: Optional[UUID] = None
    evolution_instance: str = "guyfolkiz"
    alert_phone: Optional[str] = None
    notes: Optional[str] = None
    status: str = "active"


class SubscriptionUpdate(BaseModel):
    client_name: Optional[str] = None
    description: Optional[str] = None
    amount_cents: Optional[int] = None
    billing_day: Optional[int] = Field(None, ge=1, le=28)
    contact_id: Optional[UUID] = None
    project_id: Optional[UUID] = None
    evolution_instance: Optional[str] = None
    alert_phone: Optional[str] = None
    notes: Optional[str] = None
    status: Optional[str] = None


class SubscriptionPaymentResponse(BaseModel):
    id: UUID
    subscription_id: UUID
    reference_month: str
    amount_cents: int
    status: str
    paid_at: Optional[datetime] = None
    payment_method: Optional[str] = None
    notes: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class SubscriptionResponse(BaseModel):
    id: UUID
    client_name: str
    description: Optional[str] = None
    amount_cents: int
    currency: str
    billing_day: int
    status: str
    evolution_instance: Optional[str] = None
    alert_phone: Optional[str] = None
    notes: Optional[str] = None
    contact_id: Optional[UUID] = None
    project_id: Optional[UUID] = None
    contact_name: Optional[str] = None
    project_name: Optional[str] = None
    payments: list[SubscriptionPaymentResponse] = []
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class RegisterPaymentRequest(BaseModel):
    reference_month: str = Field(..., description="Mês de referência YYYY-MM")
    amount_cents: Optional[int] = None
    payment_method: Optional[str] = Field(None, description="pix, transferencia, boleto, etc")
    notes: Optional[str] = None


class SubscriptionAlertResult(BaseModel):
    checked: int
    alerts_sent: int
    pending_subscriptions: list[str]


# ─── Dashboard Schemas ──────────────────────────────────────────────────


class AgentHeartbeatReport(BaseModel):
    agent_name: str = Field(..., max_length=50)
    status: str = Field(..., pattern=r"^(active|paused|idle|error)$")
    last_execution: Optional[datetime] = None
    tasks_completed_today: int = 0
    metadata: dict[str, Any] = Field(default_factory=dict)


class AgentStatusResponse(BaseModel):
    name: str
    status: str
    last_execution: Optional[datetime] = None
    tasks_completed_today: int = 0
    next_run: Optional[datetime] = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class MrrDataPoint(BaseModel):
    month: str
    amount_cents: int
    amount_brl: float


class TaskVelocityDataPoint(BaseModel):
    week_start: str
    completed: int


class MessageVolumeDataPoint(BaseModel):
    date: str
    count: int
    incoming: int = 0


# ─────────────────────────────────────────────────────────────────────────────
# Human Testing System
# ─────────────────────────────────────────────────────────────────────────────

class TesterCreate(BaseModel):
    nome: str
    whatsapp: str
    token: str


class TesterResponse(BaseModel):
    id: UUID
    nome: str
    whatsapp: str
    token: str
    ativo: bool
    criado_em: datetime

    model_config = {"from_attributes": True}


class TestPlanCreate(BaseModel):
    projeto: str
    nome: str
    descricao: str | None = None
    perfil: str
    steps: list[dict[str, Any]]
    criado_por: str | None = None


class TestPlanResponse(BaseModel):
    id: UUID
    projeto: str
    nome: str
    descricao: str | None
    perfil: str
    steps: list[dict[str, Any]]
    criado_por: str | None
    criado_em: datetime

    model_config = {"from_attributes": True}


class TestSessionCreate(BaseModel):
    plan_id: UUID
    tester_id: UUID | None = None


class TestResultResponse(BaseModel):
    id: UUID
    step_id: str
    status: str
    comentario: str | None
    screenshot_url: str | None
    criado_em: datetime

    model_config = {"from_attributes": True}


class TestSessionPublic(BaseModel):
    """Schema retornado para a testadora (sem auth)"""
    id: UUID
    status: str
    link_token: str
    plan: TestPlanResponse
    tester_nome: str | None = None
    results: list[TestResultResponse] = []

    model_config = {"from_attributes": True}


class TestSessionResponse(BaseModel):
    id: UUID
    plan_id: UUID
    tester_id: UUID | None
    status: str
    link_token: str
    enviado_em: datetime | None
    iniciado_em: datetime | None
    concluido_em: datetime | None
    criado_em: datetime
    plan: TestPlanResponse | None = None

    model_config = {"from_attributes": True}


class TestResultCreate(BaseModel):
    step_id: str
    status: str  # pass | fail | skip
    comentario: str | None = None
    screenshot_url: str | None = None
    outgoing: int = 0
