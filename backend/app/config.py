"""
Orquestra - Application Configuration
Pydantic-settings based config reading from .env
"""

from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # Database
    DATABASE_URL: str = "postgresql+asyncpg://orquestra:orquestra_pwd@db:5432/orquestra"

    # OpenRouter LLM
    OPENROUTER_API_KEY: str = ""
    OPENROUTER_BASE_URL: str = "https://openrouter.ai/api/v1"

    # Model selection
    MODEL_VISION: str = "openai/gpt-4o-mini"
    MODEL_CHAT_CHEAP: str = "openai/gpt-4o-mini"
    MODEL_CHAT_SMART: str = "openai/gpt-4o-mini"
    MODEL_TRANSCRIPTION: str = "google/gemini-2.5-flash"
    MODEL_DELIVERY_REPORT: str = "anthropic/claude-sonnet-4"
    MODEL_DELIVERY_WHATSAPP: str = "anthropic/claude-3.5-haiku"

    # Groq (optional, for audio transcription)
    GROQ_API_KEY: str = ""

    # Evolution API (WhatsApp)
    EVOLUTION_API_URL: str = ""
    EVOLUTION_API_KEY: str = ""
    EVOLUTION_INSTANCE: str = ""
    EVOLUTION_INSTANCES: str = ""  # JSON map: {"instance_name": "apikey", ...}

    # Assistant (owner-controlled WhatsApp copilot)
    OWNER_WHATSAPP: str = ""  # e.g. 5551999998888
    ASSISTANT_MODE: str = "approval"  # approval | off
    ASSISTANT_CHAT_MODEL: str = "x-ai/grok-4.1-fast"  # OpenRouter model for owner chat
    ASSISTANT_CONTEXT_TURNS: int = 30  # number of conversation turns to use per client

    # Jarbas AI Agent (Vercel AI SDK)
    JARBAS_AI_AGENT_URL: str = "http://localhost:3333"

    # App
    APP_SECRET_KEY: str = ""
    UPLOAD_DIR: str = "/app/uploads"
    MAX_AUDIO_SIZE_MB: int = 100
    YOUTUBE_PROJECT_NAME: str = "GuyFolkz"
    YOUTUBE_API_KEY: str = ""
    YOUTUBE_OAUTH_CLIENT_ID: str = ""
    YOUTUBE_OAUTH_CLIENT_SECRET: str = ""
    YOUTUBE_OAUTH_REDIRECT_URI: str = ""
    YOUTUBE_OAUTH_SCOPES: str = (
        "https://www.googleapis.com/auth/youtube,"
        "https://www.googleapis.com/auth/yt-analytics.readonly"
    )

    # Daily briefing
    BRIEFING_HOUR: int = 7

    # Telegram notifications
    TELEGRAM_BOT_TOKEN: str = ""
    TELEGRAM_CHAT_ID: str = ""

    # Notion API
    NOTION_API_KEY: str = ""
    NOTION_API_VERSION: str = "2022-06-28"

    model_config = {
        "env_file": ".env",
        "env_file_encoding": "utf-8",
        "extra": "ignore",
    }


@lru_cache()
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
