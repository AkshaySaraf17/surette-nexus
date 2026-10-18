"""Settings for the AI service, read from the environment (no secrets in code)."""

from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    ollama_url: str
    chat_model: str
    embed_model: str
    embed_dim: int
    token: str | None
    production: bool
    request_timeout_s: float

    @property
    def auth_required(self) -> bool:
        return self.production or bool(self.token)


def load_settings() -> Settings:
    production = os.environ.get("NODE_ENV") == "production" or os.environ.get("ML_ENV") == "production"
    token = (os.environ.get("ML_SERVICE_TOKEN") or "").strip() or None
    if production and not token:
        raise RuntimeError("ML_SERVICE_TOKEN must be set in production")
    return Settings(
        ollama_url=(os.environ.get("OLLAMA_URL") or "http://localhost:11434").rstrip("/"),
        chat_model=os.environ.get("OLLAMA_MODEL") or "llama3.2:3b",
        embed_model=os.environ.get("OLLAMA_EMBED_MODEL") or "mxbai-embed-large",
        embed_dim=int(os.environ.get("EMBED_DIM") or 1024),
        token=token,
        production=production,
        request_timeout_s=float(os.environ.get("ML_REQUEST_TIMEOUT_S") or 60),
    )
