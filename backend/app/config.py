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
    MODEL_DELIVERY_REPORT: str = "x-ai/grok-4.1-fast"
    MODEL_DELIVERY_WHATSAPP: str = "x-ai/grok-4.1-fast"

    # Groq (optional, for audio transcription)
    GROQ_API_KEY: str = ""

    # Evolution API (WhatsApp)
    EVOLUTION_API_URL: str = ""
    EVOLUTION_API_KEY: str = ""
    EVOLUTION_INSTANCE: str = ""
    EVOLUTION_INSTANCES: str = ""  # JSON map: {"instance_name": "apikey", ...}
    VAPID_PUBLIC_KEY: str = ""
    VAPID_PRIVATE_KEY: str = ""
    VAPID_SUBJECT: str = "mailto:diego@guyfolkz.com"

    # Assistant (owner-controlled WhatsApp copilot)
    OWNER_WHATSAPP: str = ""  # e.g. 5551999998888
    ASSISTANT_MODE: str = "approval"  # approval | off
    ASSISTANT_CHAT_MODEL: str = "x-ai/grok-4.1-fast"  # OpenRouter model for owner chat
    ASSISTANT_CONTEXT_TURNS: int = 30  # number of conversation turns to use per client

    # Jarbas AI Agent (Vercel AI SDK)
    JARBAS_AI_AGENT_URL: str = "http://localhost:3333"
    CLIENT_PORTAL_URL: str = ""

    # App
    APP_SECRET_KEY: str = ""
    WIKI_SECRET_KEY: str = ""  # chave exclusiva para /api/wiki/* (mais restrita que APP_SECRET_KEY)
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

    # Instagram (Meta Graph API)
    INSTAGRAM_APP_ID: str = ""
    INSTAGRAM_APP_SECRET: str = ""
    INSTAGRAM_OAUTH_REDIRECT_URI: str = ""

    # TikTok (Content Posting API)
    TIKTOK_CLIENT_KEY: str = ""
    TIKTOK_CLIENT_SECRET: str = ""
    TIKTOK_OAUTH_REDIRECT_URI: str = ""

    # Stripe (Community Payments)
    STRIPE_SECRET_KEY: str = ""
    STRIPE_WEBHOOK_SECRET: str = ""
    STRIPE_PRICE_ID: str = "price_1TFq8KBTNDZbAlO2k4JiAJUh"  # R$70/month community subscription
    COMMUNITY_SUCCESS_URL: str = "https://guyyfolkz.mbest.site/membros?enrolled=true"
    COMMUNITY_CANCEL_URL: str = "https://guyyfolkz.mbest.site/comunidade"

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
