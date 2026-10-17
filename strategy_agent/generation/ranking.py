"""Ranking.

    score = w1 * model_confidence + w2 * historical_uplift_similarity + w3 * constraint_fit + w4 * shared_insight_support

All four terms are in [0, 1]. The weights come from config and the full breakdown is stored with the recommendation,
so any rank can be explained after the fact.
"""
from __future__ import annotations

import math
import re
from typing import Optional

from ..channels import CHANNEL_VOCAB
from ..learning.feedback import primary_metric, uplift_from
from ..schemas import SHARE_TOLERANCE, GenerateRequest, Strategy
from .rag import SharedEvidence


def _vec(mix: dict[str, float]) -> list[float]:
    return [mix.get(ch, 0.0) for ch in CHANNEL_VOCAB]


def cosine(a: dict[str, float], b: dict[str, float]) -> float:
    va, vb = _vec(a), _vec(b)
    na, nb = math.sqrt(sum(x * x for x in va)), math.sqrt(sum(x * x for x in vb))
    return sum(x * y for x, y in zip(va, vb)) / (na * nb) if na and nb else 0.0


def strategy_mix(s: Strategy) -> dict[str, float]:
    return {c.channel: c.budget_share for c in s.channels}


def effective_budget(req: GenerateRequest) -> float:
    return min(req.business_profile.monthly_budget, req.constraints.budget_cap or float("inf"))


def implied_spend(s: Strategy, req: GenerateRequest) -> float:
    """What the plan would spend: its budget shares applied to the effective budget (the monthly budget, capped by budget_cap)."""
    return sum(c.budget_share for c in s.channels) * effective_budget(req)


def compliance_violations(s: Strategy, req: GenerateRequest) -> list[str]:
    """Hard problems: blocked channels, channels outside an explicit allow-list, spend above the budget, shares that do not sum to 1."""
    c, used = req.constraints, {ch.channel for ch in s.channels}
    out = [f"blocked channel {ch}" for ch in sorted(used & set(c.channels_blocked))]
    if implied_spend(s, req) > effective_budget(req) * (1 + SHARE_TOLERANCE):
        out.append("implied spend exceeds the budget (or budget cap)")
    if c.channels_allowed:
        out += [f"channel {ch} not in allowed list" for ch in sorted(used - set(c.channels_allowed))]
    if abs(sum(ch.budget_share for ch in s.channels) - 1.0) > SHARE_TOLERANCE:
        out.append("budget shares do not sum to 1")
    return out


def constraint_fit(s: Strategy, req: GenerateRequest) -> float:
    c, mix = req.constraints, strategy_mix(s)
    if set(mix) & set(c.channels_blocked):
        return 0.0
    fit = 1.0
    if c.channels_allowed:
        fit -= sum(v for ch, v in mix.items() if ch not in c.channels_allowed)
    total = sum(mix.values())
    fit -= min(0.3, abs(total - 1.0) * 3)
    for note in c.compliance_notes:  # e.g. "no sms", "avoid email": a light keyword rule, documented as heuristic
        for ch in mix:
            if re.search(rf"\b(no|avoid|without|exclude)\s+{re.escape(ch.replace('_', ' '))}\b", note.lower()):
                fit -= mix[ch]
    return max(0.0, min(1.0, fit))


def historical_uplift_similarity(s: Strategy, history: list[dict], objective: str) -> float:
    """How closely the strategy's channel mix resembles the tenant's past campaigns that beat the tenant's own baseline."""
    metric, lower = primary_metric(objective)
    rows = [c for c in history if c["objective"] == objective and c.get("outcome") and metric in c["outcome"]]
    if len(rows) < 2:
        return 0.5  # neutral: not enough history to say anything
    baseline = sum(c["outcome"][metric] for c in rows) / len(rows)
    num = den = 0.0
    for c in rows:
        u = uplift_from(c["outcome"][metric], baseline, lower)
        w = max(0.0, min(1.0, u)) if u is not None else 0.0
        num += w * cosine(strategy_mix(s), c["channel_mix"])
        den += w
    return num / den if den > 0 else 0.5


def shared_insight_support(s: Strategy, shared: list[SharedEvidence]) -> float:
    if not shared:
        return 0.0
    total = sum(e.support_count for e in shared)
    return sum(e.support_count * cosine(strategy_mix(s), e.channel_mix) for e in shared) / total


def rank_strategies(strategies: list[Strategy], req: GenerateRequest, history: list[dict], shared: list[SharedEvidence],
                    weights: dict[str, float]) -> tuple[list[Strategy], dict]:
    scored = []
    for s in strategies:
        parts = {"confidence": s.confidence, "uplift": historical_uplift_similarity(s, history, req.objective.type),
                 "constraint": constraint_fit(s, req), "shared": shared_insight_support(s, shared)}
        score = sum(weights[k] * v for k, v in parts.items())
        scored.append((score, s, parts))
    scored.sort(key=lambda t: (-t[0], t[1].title))
    breakdown = {"formula": "w1*confidence + w2*uplift_similarity + w3*constraint_fit + w4*shared_support", "weights": weights, "scores": {}}
    ranked = []
    for i, (score, s, parts) in enumerate(scored, start=1):
        ranked.append(s.model_copy(update={"rank": i}))
        breakdown["scores"][s.strategy_id] = {"score": round(score, 4), **{k: round(v, 4) for k, v in parts.items()}}
    return ranked, breakdown
