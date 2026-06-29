"""
Application settings management using Pydantic.
Loads configuration from environment variables and .env file.

Author: João Machete
"""

import os
from typing import List, Optional
from pydantic_settings import BaseSettings, SettingsConfigDict
from dotenv import load_dotenv

load_dotenv()

origins = [
    "https://gitscape.ai",
    "https://www.gitscape.ai",
    "http://localhost:5173",  # Local development (Vite default)
    "http://localhost:5174",  # Local development (Vite fallback port)
    "http://localhost:5175",  # Local development (Vite fallback port)
    "http://localhost:8000",  # Local development
    "http://127.0.0.1:5173",  # Local development (127.0.0.1 alias)
    "http://127.0.0.1:5174",  # Local development (127.0.0.1 alias, fallback)
    "http://127.0.0.1:5175",  # Local development (127.0.0.1 alias, fallback)
]


class Settings(BaseSettings):
    """
    Application settings loaded from environment variables
    """

    # App settings
    APP_NAME: Optional[str] = os.getenv("APP_NAME", "GitScape")
    APP_DESCRIPTION: Optional[str] = os.getenv(
        "APP_DESCRIPTION", "Git repository analysis and digest generation tool"
    )
    APP_VERSION: Optional[str] = os.getenv("APP_VERSION", "0.1.0")
    ENVIRONMENT: str = os.getenv("ENVIRONMENT", "development")
    DEBUG: bool = ENVIRONMENT == "development"

    # HD skill prose (Gemini Flash). Held server-side so the key never ships to
    # the browser. The deterministic skill build never reads this.
    GEMINI_API_KEY: Optional[str] = os.getenv("GEMINI_API_KEY", "")
    HD_MODEL: str = os.getenv("HD_MODEL", "gemini-3.1-flash-lite")

    # CORS settings
    # CORS_ORIGINS: List[str] = origins

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


# Create a settings instance that will be imported by other modules
settings = Settings()
