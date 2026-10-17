"""POST /v1/strategy/generate, as a service object.

  1 load tenant context   2 RAG (tenant namespace + shared insights)   3 build prompt   4 generate N strategies (JSON)
  5 rank                  6 persist the recommendation with its provenance (model_version, adapter_id, evidence ids, prompt_hash)
"""
from __future__ import annotations

import logging
import uuid
from dataclasses import replace
from typing import Optional

from ..auth import TenantContext
from ..config import Settings
from ..db.shared_store import SharedReader
from ..db.tenant_store import TenantStore
from ..schemas import Evidence, GenerateRequest, GenerateResponse, Strategy
from .generator import GenerationError, Generator, TemplateGenerator, parse_and_validate
from .prompt import PromptBundle, build_prompt
from .rag import Retriever, retrieve_shared, retrieve_tenant
from .ranking import rank_strategies

log = logging.getLogger("strategy_agent.generation")
NUDGE = {"role": "user", "content": "Your previous reply was not valid. Reply with ONLY a valid JSON array that follows the schema exactly."}


class InfeasibleRequest(ValueError):
    """The constraints leave no valid strategy (for example every channel is blocked)."""


class StrategyService:
    def __init__(self, settings: Settings, tenants: TenantStore, shared: SharedReader, primary: Optional[Generator],
                 fallback: TemplateGenerator, retriever: Retriever) -> None:
        self.settings, self.tenants, self.shared = settings, tenants, shared
        self.primary, self.fallback, self.retriever = primary, fallback, retriever

    # ------------------------------------------------------------------------------------------ generation with fallback
    def _produce(self, bundle: PromptBundle, warnings: list[str]) -> tuple[list[Strategy], str]:
        req, n = bundle.request, bundle.n
        valid: list[Strategy] = []
        if self.primary is not None and self.primary.available():
            for attempt in (1, 2):  # one retry on invalid output
                tries = bundle if attempt == 1 else replace(bundle, messages=bundle.messages + [NUDGE])
                try:
                    valid = parse_and_validate(self.primary.generate(tries), req, warnings)
                    break
                except Exception as exc:  # GenerationError or anything the model stack raises: never fail the request
                    warnings.append(f"{self.primary.name} attempt {attempt} unusable: {str(exc)[:120]}")
                    log.info("%s attempt %d unusable: %s", self.primary.name, attempt, type(exc).__name__)
        used = self.primary.name if valid else self.fallback.name
        if valid and len(valid) < n:
            warnings.append(f"{self.primary.name} returned {len(valid)}/{n} valid strategies; the rest come from the template generator")
            valid = valid[:n] + [Strategy.model_validate(self.fallback._strategy(bundle, req, i)) for i in range(len(valid), n)]
            used = f"{self.primary.name}+{self.fallback.name}"
        elif valid:
            valid = valid[:n]
        else:
            if self.primary is not None:
                warnings.append("fell back to the deterministic template generator")
            try:
                valid = parse_and_validate(self.fallback.generate(bundle), req, warnings)
            except GenerationError as exc:
                raise InfeasibleRequest(f"the constraints leave no valid strategy: {exc}") from exc
        return valid, used

    # ------------------------------------------------------------------------------------------ public entry point
    def generate(self, ctx: TenantContext, req: GenerateRequest) -> GenerateResponse:
        repo = self.tenants.scoped(ctx)                                                      # 1. tenant context (token-derived)
        repo.upsert_profile(req.business_profile.model_dump())
        history = repo.list_campaigns(limit=100)
        k = self.settings.rag_top_k
        tenant_ev = retrieve_tenant(repo, req, k, self.retriever)                            # 2. RAG
        shared_ev = retrieve_shared(self.shared, req, k, self.retriever) if req.use_shared_insights else []
        bundle = build_prompt(req, req.n_strategies, tenant_ev, shared_ev)                   # 3. prompt
        warnings: list[str] = []
        strategies, used = self._produce(bundle, warnings)                                   # 4. generate (+ validate / retry / fallback)

        evidence = Evidence(tenant_sources=[e.campaign_id for e in tenant_ev], shared_insights=[e.insight_id for e in shared_ev])
        strategies = [s.model_copy(update={"evidence": evidence}) for s in strategies]       # we know exactly what was in the prompt
        ranked, breakdown = rank_strategies(strategies, req, history, shared_ev, self.settings.rank_weights)   # 5. rank

        uses_llm = used.startswith("llm")
        model_version = self.settings.llm_model_name if uses_llm else "template-rules-v1"
        adapter_id = self.settings.adapter_id if (uses_llm and self.settings.adapter_path) else "none"
        rid = str(uuid.uuid4())
        repo.save_recommendation(                                                            # 6. persist with provenance
            recommendation_id=rid, request=req.model_dump(), strategies=[s.model_dump() for s in ranked], model_version=model_version,
            adapter_id=adapter_id, generator_used=used, evidence=evidence.model_dump(), prompt_hash=bundle.prompt_hash,
            prompt_text=bundle.text, ranking=breakdown)
        return GenerateResponse(recommendation_id=rid, model_version=model_version, adapter_id=adapter_id, generator_used=used,
                                strategies=ranked, evidence_ids=evidence, ranking=breakdown, warnings=warnings)
