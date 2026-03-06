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

    # Groq (optional, for audio transcription)
    GROQ_API_KEY: str = ""

    # Evolution API (WhatsApp)
    EVOLUTION_API_URL: str = ""
    EVOLUTION_API_KEY: str = ""
    EVOLUTION_INSTANCE: str = ""
    EVOLUTION_INSTANCES: str = ""  # JSON map: {"instance_name": "apikey", ...}

    # App
    APP_SECRET_KEY: str = ""
    UPLOAD_DIR: str = "/app/uploads"
    MAX_AUDIO_SIZE_MB: int = 100

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
