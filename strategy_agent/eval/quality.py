"""Quality rubric: relevance / specificity / feasibility / coherence on a fixed 1-5 scale.

This is a DETERMINISTIC HEURISTIC, not human judgement and not an LLM judge. Each dimension is five yes/no checks, scored
1 + 4 * (checks passed / 5). It rewards things that are checkable (does the plan cover the horizon, are budgets spread sanely,
do the KPIs include the objective's KPI) and cannot tell whether a plan is genuinely clever.
"""
from __future__ import annotations

from ..schemas import GenerateRequest, Strategy
from .simulator import BM_BOOST, OBJ_BOOST

UPLIFT_METRICS = {"lead_gen": {"cpl_reduction", "cpl", "leads", "lead_volume_increase"}, "awareness": {"reach_growth", "ctr", "impressions", "reach"},
                  "retention": {"repeat_rate_increase", "retention_rate", "conversion_rate", "repeat_rate"}, "sales": {"roi_increase", "roi", "revenue_growth", "conversion_rate"}}


def _score(checks: list[bool]) -> float:
    return round(1 + 4 * sum(checks) / len(checks), 3)


def relevance(s: Strategy, req: GenerateRequest) -> float:
    mix = {c.channel: c.budget_share for c in s.channels}
    bm = sum(v for c, v in mix.items() if c in BM_BOOST[req.business_profile.business_model])
    obj = sum(v for c, v in mix.items() if c in OBJ_BOOST[req.objective.type])
    text = " ".join([s.summary, s.rationale, *s.audience_segments]).lower()
    return _score([bm >= 0.6, bm >= 0.8, obj >= 0.4, obj >= 0.6, req.business_profile.target_audience.split()[0].lower() in text or req.business_profile.industry.lower() in text])


def specificity(s: Strategy, req: GenerateRequest) -> float:
    weeks = {t.week for t in s.timeline}
    return _score([len(weeks) >= 4, all(len(t.actions) >= 2 for t in s.timeline) if s.timeline else False, len(s.kpis) >= 2,
                   len(s.audience_segments) >= 2, sum(c.channel.replace("_", " ") in (s.rationale + s.summary).lower() for c in s.channels) >= 1])


def feasibility(s: Strategy, req: GenerateRequest) -> float:
    budget = min(req.business_profile.monthly_budget, req.constraints.budget_cap or float("inf"))
    max_channels = 3 if budget < 1000 else 5 if budget < 5000 else 8
    return _score([max(c.budget_share for c in s.channels) <= 0.7, len(s.channels) <= max_channels,
                   (max(t.week for t in s.timeline) <= max(req.objective.horizon_weeks, 4)) if s.timeline else False,
                   s.expected_uplift.high <= 0.6, 0.3 <= s.confidence <= 0.95])


def coherence(s: Strategy, req: GenerateRequest) -> float:
    top2 = [c.channel for c in sorted(s.channels, key=lambda c: -c.budget_share)[:2]]
    text = (s.summary + " " + s.rationale).lower()
    return _score([any(k.name == req.objective.target_kpi for k in s.kpis), s.expected_uplift.metric in UPLIFT_METRICS[req.objective.type],
                   any(c.replace("_", " ") in text for c in top2), len(s.messaging_angles) >= 2,
                   req.objective.type.replace("_", " ") in s.title.lower() or req.business_profile.industry.lower() in s.title.lower()])


def rubric(s: Strategy, req: GenerateRequest) -> dict[str, float]:
    r = {"relevance": relevance(s, req), "specificity": specificity(s, req), "feasibility": feasibility(s, req), "coherence": coherence(s, req)}
    r["overall"] = round(sum(r.values()) / 4, 3)
    return r
