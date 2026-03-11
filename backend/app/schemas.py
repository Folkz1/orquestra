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
    action_items: list[dict[str, Any]] = Field(default_factory=list)
    decisions: list[dict[str, Any]] = Field(default_factory=list)
    key_topics: list[str] = Field(default_factory=list)
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
