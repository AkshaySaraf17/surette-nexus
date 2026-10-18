"""
FastAPI app for the AI service. Internal only: the web app and worker call it; browsers never do.

    POST /v1/chunk   pages → chunks (with page numbers)
    POST /v1/embed   texts → vectors (query or document embeddings)
    POST /v1/answer  question + passages → checked, cited answer
    GET  /health     liveness + whether Ollama and the models are reachable

Run locally:  cd ml && .venv/bin/uvicorn surette_ml.app:app --port 8600
"""

from __future__ import annotations

import hmac
import logging
import time
from functools import lru_cache
from typing import Literal

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from . import rag
from .config import Settings, load_settings

log = logging.getLogger("surette_ml")
logging.basicConfig(level=logging.INFO, format='{"level":"%(levelname)s","service":"surette-ml","msg":"%(message)s"}')

settings: Settings = load_settings()
app = FastAPI(title="Surette Nexus AI service", version="1.0.0", docs_url=None if settings.production else "/docs", redoc_url=None)


def require_token(authorization: str | None = Header(default=None)) -> None:
    if not settings.auth_required:
        return
    supplied = (authorization or "").removeprefix("Bearer ").strip()
    if not supplied or not hmac.compare_digest(supplied, settings.token or ""):
        raise HTTPException(status_code=401, detail="unauthorized")


@lru_cache(maxsize=1)
def embedder():
    from llama_index.embeddings.ollama import OllamaEmbedding

    return OllamaEmbedding(model_name=settings.embed_model, base_url=settings.ollama_url, request_timeout=settings.request_timeout_s)


@lru_cache(maxsize=1)
def llm():
    from llama_index.llms.ollama import Ollama

    # Low temperature: answers should copy facts, not be creative.
    return Ollama(model=settings.chat_model, base_url=settings.ollama_url, request_timeout=settings.request_timeout_s, temperature=0.1, context_window=8192)


class PageIn(BaseModel):
    page: int = Field(ge=1, le=10_000)
    text: str = Field(max_length=200_000)


class ChunkRequest(BaseModel):
    pages: list[PageIn] = Field(max_length=500)
    chunk_size: int = Field(default=220, ge=64, le=1024)
    overlap: int = Field(default=40, ge=0, le=256)


class EmbedRequest(BaseModel):
    texts: list[str] = Field(min_length=1, max_length=256)
    kind: Literal["query", "document"] = "document"


class PassageIn(BaseModel):
    id: str = Field(max_length=100)
    label: str = Field(max_length=200)
    page: int | None = None
    text: str = Field(max_length=4_000)


class AnswerRequest(BaseModel):
    question: str = Field(min_length=2, max_length=500)
    passages: list[PassageIn] = Field(max_length=12)


@app.get("/health")
def health() -> dict:
    ok, models = False, []
    try:
        r = httpx.get(f"{settings.ollama_url}/api/tags", timeout=2)
        models = [m["name"] for m in r.json().get("models", [])]
        ok = r.status_code == 200
    except Exception:
        pass
    has = lambda name: any(m.split(":")[0] == name.split(":")[0] for m in models)  # noqa: E731
    return {"status": "ok", "ollama": ok, "chat_model": settings.chat_model if has(settings.chat_model) else None, "embed_model": settings.embed_model if has(settings.embed_model) else None}


@app.post("/v1/chunk", dependencies=[Depends(require_token)])
def chunk(req: ChunkRequest) -> dict:
    chunks = rag.chunk_pages([rag.Page(p.page, p.text) for p in req.pages], req.chunk_size, req.overlap)
    return {"chunks": [c.__dict__ for c in chunks]}


@app.post("/v1/embed", dependencies=[Depends(require_token)])
def embed(req: EmbedRequest) -> dict:
    started = time.perf_counter()
    try:
        vectors = rag.embed(embedder(), [t[:8_000] for t in req.texts], req.kind, settings.embed_model)
    except Exception as exc:
        log.warning("embedding failed: %s", type(exc).__name__)
        raise HTTPException(status_code=503, detail="embedding model unavailable") from exc
    if any(len(v) != settings.embed_dim for v in vectors):
        raise HTTPException(status_code=500, detail=f"expected {settings.embed_dim}-dimension vectors")
    log.info("embedded %d %s texts in %.0f ms", len(vectors), req.kind, (time.perf_counter() - started) * 1000)
    return {"model": settings.embed_model, "dim": settings.embed_dim, "vectors": vectors}


@app.post("/v1/answer", dependencies=[Depends(require_token)])
def answer(req: AnswerRequest) -> dict:
    passages = [rag.Passage(p.id, p.label, p.page, p.text) for p in req.passages]
    model = None
    try:
        model = llm()
    except Exception:
        model = None
    result = rag.answer(req.question, passages, model, engine_name=f"ollama:{settings.chat_model}")
    log.info("answer engine=%s grounded=%s reason=%s", result.engine, result.grounded, result.reason)
    return result.__dict__
