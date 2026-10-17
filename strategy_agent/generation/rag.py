"""Retrieval. Two namespaces, kept strictly apart:

  * the TENANT's own campaigns (fetched through the tenant-scoped repo, so only that tenant's rows can ever be returned);
  * the SHARED insights (read-only SharedReader, anonymised aggregates, no tenant identifier exists in them).

Similarity uses sentence embeddings (BAAI/bge-small-en-v1.5) when available and cached locally, otherwise TF-IDF.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Optional

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer

from ..db.shared_store import SharedReader
from ..db.tenant_store import TenantRepo
from ..privacy.anonymizer import budget_band, industry_bucket, region_bucket
from ..schemas import GenerateRequest

log = logging.getLogger("strategy_agent.rag")


@dataclass
class TenantEvidence:
    campaign_id: str
    summary: str
    channel_mix: dict[str, float]
    outcome: Optional[dict]
    objective: str
    score: float = 0.0


@dataclass
class SharedEvidence:
    insight_id: str
    summary: str
    channel_mix: dict[str, float]
    outcome_metrics: dict[str, float]
    support_count: int
    score: float = 0.0


class Retriever:
    def __init__(self, backend: str = "auto", embedding_model: str = "BAAI/bge-small-en-v1.5") -> None:
        self.backend, self.embedding_model = backend, embedding_model
        self._st = None
        self._st_failed = backend == "tfidf"

    def _embedder(self):
        if self._st is None and not self._st_failed:
            try:
                from sentence_transformers import SentenceTransformer

                self._st = SentenceTransformer(self.embedding_model, device="cpu", local_files_only=True)
            except Exception as exc:  # not installed, or the model is not cached locally
                log.info("embeddings unavailable (%s); using TF-IDF", type(exc).__name__)
                self._st_failed = True
        return self._st

    @property
    def engine(self) -> str:
        return "embeddings" if self._embedder() is not None else "tfidf"

    def similarities(self, query: str, docs: list[str]) -> list[float]:
        if not docs:
            return []
        model = self._embedder()
        if model is not None:
            vecs = model.encode([query] + docs, normalize_embeddings=True, show_progress_bar=False)
            return [float(v) for v in (vecs[1:] @ vecs[0])]
        try:
            m = TfidfVectorizer(stop_words="english").fit_transform([query] + docs)
        except ValueError:  # only stop-words / empty vocabulary
            return [0.0] * len(docs)
        sims = (m[1:] @ m[0].T).toarray().ravel()
        return [float(x) for x in np.clip(sims, 0, 1)]


def request_query(req: GenerateRequest) -> str:
    p, o = req.business_profile, req.objective
    return f"{o.type} {o.target_kpi} {p.industry} {p.business_model} {p.target_audience} {p.region} {p.brand_tone}"


def describe_campaign(c: dict) -> str:
    mix = ", ".join(f"{ch} {share:.0%}" for ch, share in sorted(c["channel_mix"].items(), key=lambda kv: -kv[1]))
    out = c.get("outcome") or {}
    res = ", ".join(f"{k} {out[k]}" for k in ("roi", "cpl", "ctr", "conversion_rate") if k in out)
    return f"{c['objective']} campaign, {c['industry']}, {c['region']}, budget {budget_band(c['monthly_budget'])}; channels {mix}; results {res or 'n/a'}"


def retrieve_tenant(repo: TenantRepo, req: GenerateRequest, k: int, retriever: Retriever) -> list[TenantEvidence]:
    campaigns = [c for c in repo.list_campaigns(limit=100) if c["status"] == "completed"]
    if not campaigns:
        return []
    texts = [describe_campaign(c) for c in campaigns]
    sims = retriever.similarities(request_query(req), texts)
    ranked = sorted(
        ((s + (0.25 if c["objective"] == req.objective.type else 0.0), c, t) for s, c, t in zip(sims, campaigns, texts)),
        key=lambda x: -x[0],
    )
    return [TenantEvidence(c["id"], t, c["channel_mix"], c.get("outcome"), c["objective"], round(s, 4)) for s, c, t in ranked[:k]]


def retrieve_shared(reader: SharedReader, req: GenerateRequest, k: int, retriever: Retriever) -> list[SharedEvidence]:
    """Filtered by industry bucket + objective (hard filters), then ranked; read-only and tenant-free by construction."""
    bucket, objective = industry_bucket(req.business_profile.industry), req.objective.type
    rows = reader.query_insights(industry_bucket=bucket, objective=objective, limit=50)
    if not rows:
        return []
    sims = retriever.similarities(request_query(req), [r["summary"] for r in rows])
    region, band = region_bucket(req.business_profile.region), budget_band(req.business_profile.monthly_budget)
    scored = sorted(
        ((s + (0.2 if r["region"] == region else 0.0) + (0.1 if r["budget_band"] == band else 0.0), r) for s, r in zip(sims, rows)),
        key=lambda x: -x[0],
    )
    return [SharedEvidence(r["contribution_id"], r["summary"], r["channel_mix"], r["outcome_metrics"], r["support_count"], round(s, 4))
            for s, r in scored[:k]]
