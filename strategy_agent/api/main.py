"""FastAPI application factory."""
from __future__ import annotations

from pathlib import Path
from typing import Optional

from fastapi import FastAPI
from fastapi.responses import FileResponse

_UI_INDEX = Path(__file__).resolve().parent.parent / "ui" / "index.html"

from ..config import Settings, get_settings
from ..db.shared_store import SharedReader, SharedStore
from ..db.tenant_store import TenantStore
from ..generation.generator import Generator, TemplateGenerator, build_generators
from ..generation.rag import Retriever
from ..generation.service import StrategyService
from ..privacy.anonymizer import Anonymizer
from ..privacy.pipeline import ConsentGatedPipeline
from .routes import consent, feedback, generate, insights


def create_app(settings: Optional[Settings] = None, primary: Optional[Generator] = None, use_default_generators: bool = True) -> FastAPI:
    settings = settings or get_settings()
    app = FastAPI(title="Strategy Agent", version="0.1.0")
    app.state.settings = settings
    app.state.tenant_store = TenantStore(settings.resolve(settings.tenant_db_path))
    shared_writer = SharedStore(settings.resolve(settings.shared_db_path))
    app.state.shared_reader = SharedReader(settings.resolve(settings.shared_db_path))  # all API routes get this (read-only)
    app.state.anonymizer = Anonymizer()
    app.state.pipeline = ConsentGatedPipeline(app.state.tenant_store, shared_writer, app.state.anonymizer, settings)  # the only writer

    if use_default_generators and primary is None:
        primary, fallback = build_generators(settings.generator_backend, settings.llm_model_name, settings.max_new_tokens, settings.adapter_path, settings.llm_load_4bit)
    else:
        fallback = TemplateGenerator()
    app.state.service = StrategyService(settings, app.state.tenant_store, app.state.shared_reader, primary, fallback,
                                        Retriever(settings.rag_backend, settings.embedding_model))

    app.include_router(generate.router)
    app.include_router(feedback.router)
    app.include_router(consent.router)
    app.include_router(insights.router)

    @app.get("/health")
    def health() -> dict:
        gen = app.state.service.primary.name if app.state.service.primary else "template"
        return {"status": "ok", "service": "strategy-agent", "version": app.version, "generator": gen}

    @app.get("/", include_in_schema=False)
    def ui() -> FileResponse:
        return FileResponse(_UI_INDEX)

    return app
