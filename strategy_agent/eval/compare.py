"""Simulated A/B: compare strategy-producing systems on the learned outcome simulator.

Every system proposes ONE channel mix per brief (the agent systems use their rank-1 strategy). The simulator predicts the
objective's primary metric for that mix and the improvement over the naive reference (an even split over the allowed channels).
Comparisons are paired by brief; we report the mean, a bootstrap 95% CI, and a Wilcoxon signed-rank p-value.
"""
from __future__ import annotations

import random
from typing import Callable, Optional

import numpy as np
from scipy import stats

from ..auth import TenantContext
from ..channels import CHANNEL_VOCAB
from ..generation.service import StrategyService
from ..schemas import BusinessProfile, Constraints, GenerateRequest, Objective
from .simulator import Context, OutcomeSimulator, World, context_for

RULE_BASELINE = {"B2B": {"linkedin_ads": .4, "google_ads": .3, "email": .3}, "B2C": {"meta_ads": .4, "google_ads": .3, "email": .3}}
KPI = {"lead_gen": ("cost_per_lead", 15.0), "awareness": ("ctr", 0.03), "retention": ("conversion_rate", 0.08), "sales": ("roi", 3.0)}
_BAND_BUDGET = {"under_1k": 700.0, "1k_5k": 2800.0, "5k_20k": 12500.0, "20k_100k": 45000.0, "over_100k": 150000.0}
_BM = {"technology": "B2B", "industrial_b2b": "B2B", "financial_services": "B2B"}
_INDUSTRY_NAME = {"retail_ecommerce": "retail", "technology": "SaaS", "education": "education", "health_wellness": "healthcare clinic",
                  "hospitality_travel": "restaurant", "financial_services": "fintech", "real_estate": "real estate", "industrial_b2b": "manufacturing",
                  "nonprofit": "nonprofit", "media_entertainment": "media", "other": "consulting"}
_REGION_NAME = {"south_asia": "Colombo, Sri Lanka", "europe": "London, UK", "north_america": "New York, USA", "asia_pacific": "Singapore",
                "latin_america": "Sao Paulo, Brazil", "middle_east_africa": "Dubai, UAE", "other": "Reykjavik"}


def boot_ci(x: list[float], seed: int = 0, b: int = 2000) -> tuple[float, float]:
    rng = np.random.default_rng(seed)
    a = np.asarray(x, dtype=float)
    means = rng.choice(a, size=(b, len(a)), replace=True).mean(axis=1)
    return float(np.percentile(means, 2.5)), float(np.percentile(means, 97.5))


def paired(a: list[float], b: list[float], seed: int = 0) -> dict:
    d = np.asarray(a) - np.asarray(b)
    lo, hi = boot_ci(list(d), seed)
    try:
        p = float(stats.wilcoxon(d).pvalue) if np.any(d != 0) else 1.0
    except ValueError:
        p = 1.0
    return {"mean_diff": round(float(d.mean()), 4), "ci95": [round(lo, 4), round(hi, 4)], "wilcoxon_p": round(p, 5), "n": len(d),
            "a_wins": int((d > 0).sum()), "b_wins": int((d < 0).sum())}


def make_briefs(insights: list[dict], n: int, seed: int) -> list[GenerateRequest]:
    """Briefs for NEW businesses that fall in groups for which shared insights exist (so the shared-insights ablation is meaningful)."""
    rng = random.Random(seed)
    out = []
    for i in range(n):
        ins = insights[i % len(insights)]
        band = ins["budget_band"] if ins["budget_band"] in _BAND_BUDGET else "1k_5k"
        blocked = rng.sample(CHANNEL_VOCAB, rng.choice([0, 0, 1, 2]))
        obj = ins["objective"]
        kpi, target = KPI[obj]
        out.append(GenerateRequest(
            business_profile=BusinessProfile(industry=_INDUSTRY_NAME.get(ins["industry_bucket"], "consulting"), business_model=_BM.get(ins["industry_bucket"], "B2C"),
                                             target_audience="small business owners" if ins["industry_bucket"] in _BM else "young professionals",
                                             region=_REGION_NAME.get(ins["region"], "Colombo, Sri Lanka"), brand_tone="friendly", monthly_budget=_BAND_BUDGET[band] + rng.randint(0, 300)),
            objective=Objective(type=obj, target_kpi=kpi, target_value=target, time_horizon="8 weeks"),
            constraints=Constraints(channels_blocked=blocked), n_strategies=3))
    return out


def allowed(req: GenerateRequest) -> list[str]:
    pool = req.constraints.channels_allowed or list(CHANNEL_VOCAB)
    return [c for c in pool if c not in req.constraints.channels_blocked]


def _uniform(chs: list[str]) -> dict[str, float]:
    return {c: 1.0 / len(chs) for c in chs}


def _rule_baseline(req: GenerateRequest) -> dict[str, float]:
    mix = {c: v for c, v in RULE_BASELINE[req.business_profile.business_model].items() if c in allowed(req)}
    total = sum(mix.values())
    return {c: v / total for c, v in mix.items()} if mix else _uniform(allowed(req))


def _mix(strategy) -> dict[str, float]:
    return {c.channel: c.budget_share for c in strategy.channels}


def evaluate_systems(world: World, sim: OutcomeSimulator, services: dict[str, StrategyService], briefs: list[GenerateRequest], seed: int = 0,
                     progress: Optional[Callable[[str], None]] = None) -> dict:
    """services: {'agent_template': service, 'agent_llm': service (optional)} - each is run with and without shared insights."""
    rng = np.random.default_rng(seed)
    pred: dict[str, list[float]] = {}
    true: dict[str, list[float]] = {}
    top1_vs_rest, spearman = [], []
    used: dict[str, list[str]] = {}

    def add(name: str, mix: dict[str, float], ctx: Context, ref: dict[str, float]) -> None:
        pred.setdefault(name, []).append(sim.uplift(mix, ref, ctx))
        true.setdefault(name, []).append(sim.true_uplift(mix, ref, ctx))

    for i, req in enumerate(briefs):
        ctx, chs = context_for(req), allowed(req)
        ref = _uniform(chs)
        k = min(len(chs), int(rng.integers(3, 6)))
        picked = list(rng.choice(chs, size=k, replace=False))
        add("uniform_reference", ref, ctx, ref)
        add("random_mix", dict(zip(picked, rng.dirichlet(np.ones(k)))), ctx, ref)
        add("rule_baseline", _rule_baseline(req), ctx, ref)
        for name, svc in services.items():
            for shared in (False, True):
                r = req.model_copy(update={"use_shared_insights": shared})
                res = svc.generate(TenantContext(f"newcomer-{name}-{int(shared)}-{i}", "eval", ("tenant_admin",)), r)
                label = f"{name}{'_with_shared' if shared else '_cold_start'}"
                used.setdefault(label, []).append(res.generator_used)
                add(label, _mix(res.strategies[0]), ctx, ref)
                if shared and len(res.strategies) >= 2:
                    ups = [sim.uplift(_mix(s), ref, ctx) for s in res.strategies]
                    top1_vs_rest.append(ups[0] - float(np.mean(ups[1:])))
                    if len(set(ups)) > 1:
                        spearman.append(float(stats.spearmanr([s.rank for s in res.strategies], ups).statistic))
        if progress and (i + 1) % 20 == 0:
            progress(f"simulated A/B: {i + 1}/{len(briefs)} briefs")

    table = {}
    for name, v in pred.items():
        lo, hi = boot_ci(v, seed)
        table[name] = {"mean_predicted_uplift": round(float(np.mean(v)), 4), "ci95": [round(lo, 4), round(hi, 4)],
                       "mean_true_uplift": round(float(np.mean(true[name])), 4), "win_rate_vs_uniform": round(float(np.mean(np.array(v) > 0)), 3)}
        if name in used:  # how often the generator's output was unusable and the template stood in (a model that always falls back measures the template!)
            table[name]["fell_back_to_template_rate"] = round(float(np.mean([u == "template" for u in used[name]])), 3)
    flat_p = np.concatenate([np.array(v) for v in pred.values()])
    flat_t = np.concatenate([np.array(v) for v in true.values()])
    comparisons = {}
    for svc in services:
        cold, shared = f"{svc}_cold_start", f"{svc}_with_shared"
        comparisons[f"{cold} vs rule_baseline"] = paired(pred[cold], pred["rule_baseline"], seed)
        comparisons[f"{cold} vs random_mix"] = paired(pred[cold], pred["random_mix"], seed)
        comparisons[f"{shared} vs {cold}  (ablation: cross-tenant insights)"] = paired(pred[shared], pred[cold], seed)
    return {"n_briefs": len(briefs), "systems": table, "paired_comparisons": comparisons,
            "simulator_fidelity": {"held_out_r2_log_metric": sim.r2, "pearson_predicted_vs_true_uplift": round(float(np.corrcoef(flat_p, flat_t)[0, 1]), 4)},
            "ranking": {"mean_rank1_minus_other_strategies_uplift": round(float(np.mean(top1_vs_rest)), 4) if top1_vs_rest else None,
                        "mean_spearman_rank_vs_uplift": round(float(np.mean(spearman)), 4) if spearman else None,
                        "note": "negative Spearman is good: rank 1 should have the highest predicted uplift"}}


def shared_benefit(sim: OutcomeSimulator, service: StrategyService, briefs: list[GenerateRequest], tag: str) -> float:
    """Utility of the published insights: mean predicted uplift of the top strategy WITH shared insights minus WITHOUT, for businesses with no history."""
    diffs = []
    for i, req in enumerate(briefs):
        ctx, chs = context_for(req), allowed(req)
        ref = _uniform(chs)
        up = []
        for shared in (False, True):
            res = service.generate(TenantContext(f"utility-{tag}-{int(shared)}-{i}", "eval", ("tenant_admin",)), req.model_copy(update={"use_shared_insights": shared}))
            up.append(sim.uplift(_mix(res.strategies[0]), ref, ctx))
        diffs.append(up[1] - up[0])
    return round(float(np.mean(diffs)), 4)
