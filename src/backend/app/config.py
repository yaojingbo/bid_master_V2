"""
Configuration management for Bid Master Backend.
Reads settings from environment variables.
"""
import os
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(env_file=".env", case_sensitive=False, extra="allow")

    # Database
    database_url: str = "postgresql://localhost:5432/bidmaster"

    # AI Provider: deepseek | dashscope | zhipu | minimax | openai | claude | ollama
    ai_provider: str = "deepseek"

    # LLM Providers API Keys
    deepseek_api_key: str = ""
    dashscope_api_key: str = ""
    zhipu_api_key: str = ""
    minimax_api_key: str = ""
    openai_api_key: str = ""
    claude_api_key: str = ""

    # LLM Providers API Base URLs (OpenAI-compatible providers need custom endpoints)
    deepseek_base_url: str = "https://api.deepseek.com/v1"
    dashscope_base_url: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    zhipu_base_url: str = "https://open.bigmodel.cn/api/paas/v4"
    minimax_base_url: str = "https://api.minimaxi.com/v1"

    # Ollama (optional, for local)
    ollama_base_url: str = "http://localhost:11434"

    # Encryption
    fernet_key: str = ""

    # JWT
    jwt_secret: str = "dev-secret-change-in-production"
    jwt_access_token_expire_minutes: int = 60
    jwt_refresh_token_expire_days: int = 7

    # File storage
    upload_dir: str = "./uploads"
    max_file_size: int = 50 * 1024 * 1024  # 50MB

    # Allowed file types
    allowed_mime_types: list[str] = [
        "application/pdf",
        "text/markdown",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "text/csv",
    ]

    # Email (Brevo)
    brevo_api_key: str = ""
    brevo_from: str = ""
    frontend_url: str = "http://localhost:3000"

@lru_cache()
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()