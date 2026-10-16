"""Feedback + outcome capture and the reward formula (the scoring half of continuous learning).

Primary metric per objective, and whether LOWER is better:
    lead_gen  -> cpl (lower)        awareness -> ctr (higher)
    retention -> conversion_rate    sales     -> roi (higher)

uplift  = relative improvement over THIS tenant's historical baseline for the same objective:
            higher-is-better: (value - baseline) / |baseline|        lower-is-better: (baseline - value) / |baseline|
reward  = w_outcome * clip(uplift, -1, 1)  +  w_feedback * explicit_feedback            (weights in config)
explicit_feedback = mean of the available parts of { decision_score, rating_score }
    decision_score: accepted = +1, edited = +0.5, rejected = -1        rating_score = (rating - 3) / 2
If only one of outcome / feedback exists, its weight is renormalised to 1 so a missing signal is not counted as a zero.
"""
from __future__ import annotations

from typing import Optional

PRIMARY_METRIC: dict[str, tuple[str, bool]] = {
    "lead_gen": ("cpl", True),
    "awareness": ("ctr", False),
    "retention": ("conversion_rate", False),
    "sales": ("roi", False),
}
DECISION_SCORE = {"accepted": 1.0, "edited": 0.5, "rejected": -1.0}


def primary_metric(objective: str) -> tuple[str, bool]:
    return PRIMARY_METRIC.get(objective, ("roi", False))


def uplift_from(value: Optional[float], baseline: Optional[float], lower_is_better: bool) -> Optional[float]:
    if value is None or baseline is None or baseline == 0:
        return None
    raw = (baseline - value) / abs(baseline) if lower_is_better else (value - baseline) / abs(baseline)
    return round(raw, 4)


def explicit_feedback_score(decision: Optional[str], rating: Optional[int]) -> Optional[float]:
    parts = []
    if decision is not None:
        parts.append(DECISION_SCORE[decision])
    if rating is not None:
        parts.append((rating - 3) / 2)
    return sum(parts) / len(parts) if parts else None


def compute_reward(uplift: Optional[float], feedback_score: Optional[float], weights: dict[str, float]) -> Optional[tuple[float, dict]]:
    """Returns (reward in [-1, 1], components) or None when there is no signal at all."""
    comps: dict[str, float] = {}
    if uplift is not None:
        comps["outcome"] = max(-1.0, min(1.0, uplift))
    if feedback_score is not None:
        comps["feedback"] = feedback_score
    if not comps:
        return None
    total_w = sum(weights[k] for k in comps)
    reward = sum(weights[k] * v for k, v in comps.items()) / total_w
    return round(reward, 4), {"components": comps, "weights_used": {k: weights[k] / total_w for k in comps}}
