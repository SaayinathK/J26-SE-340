"""k-anonymity gate and (optional) Laplace noise for the published aggregates.

A group of contributions that share the same quasi-identifiers
    (industry_bucket, region, budget_band, objective)
is published only if it was contributed by at least k DISTINCT tenants. Distinctness is counted with a random,
per-tenant `contributor_token` that exists only to make this count possible; it is never published.
"""
from __future__ import annotations

import uuid
from collections import Counter
from statistics import median
from typing import Optional

import numpy as np

QI_FIELDS = ("industry_bucket", "region", "budget_band", "objective")

# Clipping bounds per metric. They bound the sensitivity, which is what the Laplace scale needs.
METRIC_BOUNDS: dict[str, tuple[float, float]] = {
    "ctr": (0.0, 1.0), "conversion_rate": (0.0, 1.0), "cpl": (0.0, 500.0), "roi": (-1.0, 10.0),
    "impressions": (0.0, 5_000_000.0), "spend": (0.0, 1_000_000.0), "uplift": (-1.0, 1.0),
}
_NS = uuid.UUID("6f1d2a52-3b0e-4f6e-9a57-0c2c5e6d1b77")


def qi_key(rec: dict) -> tuple:
    return tuple(rec[f] for f in QI_FIELDS)


def group_by_qi(contribs: list[dict]) -> dict[tuple, list[dict]]:
    groups: dict[tuple, list[dict]] = {}
    for c in contribs:
        groups.setdefault(qi_key(c), []).append(c)
    return groups


def distinct_contributors(group: list[dict]) -> int:
    return len({c["contributor_token"] for c in group})


def k_gate(groups: dict[tuple, list[dict]], k: int) -> tuple[dict[tuple, list[dict]], dict[tuple, list[dict]]]:
    publishable = {key: g for key, g in groups.items() if distinct_contributors(g) >= k}
    held_back = {key: g for key, g in groups.items() if key not in publishable}
    return publishable, held_back


def _noise(scale: float, rng: np.random.Generator) -> float:
    return float(rng.laplace(0.0, scale)) if scale > 0 else 0.0


def aggregate_group(group: list[dict], epsilon: float, add_noise: bool, rng: np.random.Generator) -> tuple[dict[str, float], dict[str, float]]:
    """Mean channel mix and median outcome metrics for one group.

    Laplace scale = sensitivity / epsilon, with sensitivity = (hi - lo) / n for a clipped value over n contributors.
    This is a per-aggregate guarantee. We do NOT account for composition across repeated publications; the docs say so.
    """
    n = len(group)
    channels = sorted({ch for c in group for ch in c["channel_mix"]})
    mix = {ch: sum(c["channel_mix"].get(ch, 0.0) for c in group) / n for ch in channels}
    if add_noise and mix:
        mix = {ch: max(0.0, v + _noise((1.0 / n) / epsilon, rng)) for ch, v in mix.items()}
    total = sum(mix.values())
    mix = {ch: round(v / total, 4) for ch, v in mix.items()} if total > 0 else {}

    metrics: dict[str, float] = {}
    for name in sorted({m for c in group for m in c["outcome_metrics"]}):
        vals = [c["outcome_metrics"][name] for c in group if name in c["outcome_metrics"]]
        if not vals:
            continue
        lo, hi = METRIC_BOUNDS.get(name, (min(vals), max(vals) if max(vals) > min(vals) else min(vals) + 1.0))
        clipped = [min(max(v, lo), hi) for v in vals]
        value = float(median(clipped))
        if add_noise:
            value = min(max(value + _noise(((hi - lo) / len(vals)) / epsilon, rng), lo), hi)
        metrics[name] = round(value, 4)
    return mix, metrics


def insight_id_for(key: tuple) -> str:
    """Deterministic id from the quasi-identifiers only (so a rebuild keeps ids stable; it reveals nothing about tenants)."""
    return str(uuid.uuid5(_NS, "|".join(key)))


def most_common_angle(group: list[dict]) -> Optional[str]:
    angles = [c["angle"] for c in group if c.get("angle")]
    return Counter(angles).most_common(1)[0][0] if angles else None


def primary_metric_for(objective: str) -> str:
    return {"lead_gen": "cpl", "awareness": "ctr", "retention": "conversion_rate", "sales": "roi"}.get(objective, "roi")


def build_summary(key: tuple, mix: dict[str, float], metrics: dict[str, float], support: int) -> str:
    industry, region, band, objective = key
    top = ", ".join(f"{ch} ({share:.0%})" for ch, share in sorted(mix.items(), key=lambda kv: -kv[1])[:3]) or "no channel data"
    pm = primary_metric_for(objective)
    metric_txt = f"; median {pm} {metrics[pm]}" if pm in metrics else ""
    uplift_txt = f"; median uplift vs own baseline {metrics['uplift']:+.0%}" if "uplift" in metrics else ""
    return f"{objective} campaigns, {industry} / {region} / budget {band}: top channels {top}{metric_txt}{uplift_txt}; based on {support} businesses."
