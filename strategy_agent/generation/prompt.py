"""Chat-style prompt builder (Mistral / Qwen instruct format via the tokenizer's chat template).

Sections: business context, objective, constraints, the tenant's own evidence, cross-tenant evidence (clearly labelled and
never attributed to any business), and the exact output schema.
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass, field

from ..channels import CHANNEL_VOCAB
from ..schemas import GenerateRequest
from .rag import SharedEvidence, TenantEvidence

SYSTEM = ("You are a senior marketing strategist. You reply with ONLY a valid JSON array and nothing else: no prose, no markdown. "
          "Every strategy must follow the schema exactly, use only the allowed channels, and have budget shares that sum to 1.0.")

SCHEMA_EXAMPLE = """{
  "title": "short name", "summary": "1-2 sentences",
  "channels": [{"channel": "<allowed channel>", "budget_share": 0.4}],
  "audience_segments": ["..."], "messaging_angles": ["..."],
  "timeline": [{"week": 1, "actions": ["..."]}],
  "kpis": [{"name": "roi", "target": 2.0}],
  "expected_uplift": {"metric": "roi", "low": 0.1, "high": 0.25},
  "rationale": "why this fits the evidence", "confidence": 0.7
}"""


def mistral_instruct_prompt(messages: list[dict]) -> str:
    """The Mistral-Instruct chat format: `<s>[INST] system + user [/INST]`. Mistral has no separate system turn, so the system text is
    placed at the start of the user turn. Tokenizers for Mistral models produce the same string through their own chat template."""
    system = "\n\n".join(m["content"] for m in messages if m["role"] == "system")
    user = "\n\n".join(m["content"] for m in messages if m["role"] == "user")
    return f"<s>[INST] {system}\n\n{user} [/INST]" if system else f"<s>[INST] {user} [/INST]"


@dataclass
class PromptBundle:
    request: GenerateRequest
    n: int
    tenant_evidence: list[TenantEvidence]
    shared_evidence: list[SharedEvidence]
    messages: list[dict] = field(default_factory=list)
    text: str = ""
    prompt_hash: str = ""

    @property
    def mistral_text(self) -> str:
        return mistral_instruct_prompt(self.messages)


def build_prompt(req: GenerateRequest, n: int, tenant_ev: list[TenantEvidence], shared_ev: list[SharedEvidence]) -> PromptBundle:
    p, o, c = req.business_profile, req.objective, req.constraints
    effective_budget = min(p.monthly_budget, c.budget_cap) if c.budget_cap else p.monthly_budget
    allowed = c.channels_allowed or [ch for ch in CHANNEL_VOCAB if ch not in c.channels_blocked]
    lines = [
        "## Business context",
        f"industry: {p.industry}; model: {p.business_model}; audience: {p.target_audience}; region: {p.region}; brand tone: {p.brand_tone}; monthly budget: {p.monthly_budget:g}",
        "## Objective",
        f"type: {o.type}; KPI: {o.target_kpi}; target: {o.target_value:g}; horizon: {o.time_horizon}",
        "## Constraints",
        f"allowed channels: {', '.join(allowed)}",
        f"blocked channels: {', '.join(c.channels_blocked) or 'none'}; budget cap: {effective_budget:g}; compliance: {'; '.join(c.compliance_notes) or 'none'}",
        "## Evidence from this business's own past campaigns",
        *([f"- [{e.campaign_id}] {e.summary}" for e in tenant_ev] or ["- none yet"]),
        "## Cross-business evidence (anonymised aggregates from other businesses; NOT this business)",
        *([f"- [{e.insight_id}] {e.summary}" for e in shared_ev] or ["- none available"]),
        "## Output",
        f"Return a JSON array of exactly {n} different strategies. Each strategy follows this schema:",
        SCHEMA_EXAMPLE,
    ]
    user = "\n".join(lines)
    messages = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}]
    text = f"[system]\n{SYSTEM}\n[user]\n{user}"
    return PromptBundle(req, n, tenant_ev, shared_ev, messages, text, hashlib.sha256(text.encode()).hexdigest()[:32])
