"""
================================================================
UQU Academic Assistant — Application Configuration
================================================================
Loads settings from .env using pydantic-settings.
"""

from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    """Application settings loaded from environment variables / .env file."""

    # ── NVIDIA NIM API ──
    NVIDIA_API_KEY: str
    NVIDIA_MODEL: str = "moonshotai/kimi-k2.5"

    # ── Gemini API (for plan-generator + schedule-ai migrated from frontend) ──
    GEMINI_API_KEY: str = ""
    GEMINI_MODEL: str = "gemini-3-flash-preview"

    # ── Firebase ──
    FIREBASE_CREDENTIALS_PATH: str = "serviceAccountKey.json"

    # ── Server ──
    HOST: str = "0.0.0.0"
    PORT: int = 8000

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


@lru_cache()
def get_settings() -> Settings:
    """Cached settings singleton — loaded once at startup."""
    return Settings()
