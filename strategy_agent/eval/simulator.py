"""A hidden synthetic marketing "world" that gives strategies a ground-truth outcome, plus a simulator learned from it.

WHY it exists: with no real campaign data we cannot measure whether a strategy works. So we build a world with known (but unseen by
the generator) channel effectiveness per (industry, objective, business model) and let scikit-learn learn an outcome model from
noisy samples, exactly as it would from a real campaign log.

HONESTY: the world is designed by us. It tests the PIPELINE (can strategies be compared, does evidence help, is ranking sensible) and
NOT whether the strategies would work for a real business. The channel knowledge in it (B2B favours LinkedIn, retention favours
email ...) overlaps with common marketing sense, as does the template generator; to reduce circularity the world also contains a large
idiosyncratic component per (industry, objective) that only DATA (campaign logs, shared insights) can reveal.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
from sklearn.ensemble import GradientBoostingRegressor

from ..channels import CHANNEL_VOCAB
from ..privacy.anonymizer import INDUSTRY_BUCKETS, REGION_BUCKETS, industry_bucket, region_bucket

OBJECTIVES = ("lead_gen", "awareness", "retention", "sales")
PRIMARY = {"lead_gen": ("cpl", True), "awareness": ("ctr", False), "retention": ("conversion_rate", False), "sales": ("roi", False)}
BM_BOOST = {
    "B2B": {"linkedin_ads", "content_marketing", "seo", "webinar", "events", "email", "pr", "google_ads"},
    "B2C": {"meta_ads", "tiktok_ads", "youtube_ads", "influencer", "social", "sms", "whatsapp", "email", "google_ads"},
}
OBJ_BOOST = {
    "lead_gen": {"google_ads", "landing_page", "linkedin_ads", "meta_ads", "webinar", "email"},
    "awareness": {"youtube_ads", "tiktok_ads", "influencer", "pr", "social", "meta_ads", "events"},
    "retention": {"email", "sms", "whatsapp", "referral", "content_marketing", "webinar"},
    "sales": {"google_ads", "meta_ads", "email", "affiliate", "landing_page", "sms", "linkedin_ads"},
}
_INDUSTRIES = sorted(INDUSTRY_BUCKETS)
_REGIONS = sorted(REGION_BUCKETS)


@dataclass(frozen=True)
class Context:
    business_model: str
    objective: str
    industry: str      # an industry BUCKET
    region: str        # a region BUCKET
    budget: float


def context_for(req) -> Context:
    p = req.business_profile
    return Context(p.business_model, req.objective.type, industry_bucket(p.industry), region_bucket(p.region), p.monthly_budget)


class World:
    def __init__(self, seed: int = 0) -> None:
        rng = np.random.default_rng(seed)
        self.idio = {(ind, obj): rng.uniform(-0.25, 0.45, len(CHANNEL_VOCAB)) for ind in _INDUSTRIES for obj in OBJECTIVES}
        self.region_shift = {r: rng.normal(0, 0.05, len(CHANNEL_VOCAB)) for r in _REGIONS}

    def effectiveness(self, ctx: Context) -> np.ndarray:
        e = np.array([0.15 + 0.25 * (c in BM_BOOST[ctx.business_model]) + 0.25 * (c in OBJ_BOOST[ctx.objective]) for c in CHANNEL_VOCAB])
        e = e + self.idio[(ctx.industry, ctx.objective)] + self.region_shift[ctx.region]
        return np.clip(e, 0.0, None)

    def quality(self, mix: dict[str, float], ctx: Context) -> float:
        s = np.array([mix.get(c, 0.0) for c in CHANNEL_VOCAB])
        s = s / s.sum()
        return float(s @ self.effectiveness(ctx) - 0.5 * (s ** 2).sum())    # diminishing returns: spreading helps

    def metric(self, mix: dict[str, float], ctx: Context, rng: np.random.Generator | None = None) -> float:
        q = self.quality(mix, ctx)
        base = {"roi": 0.8 * math.exp(2.2 * q), "ctr": 0.008 * math.exp(2.0 * q), "conversion_rate": 0.02 * math.exp(2.0 * q), "cpl": 40.0 / math.exp(2.0 * q)}
        value = base[PRIMARY[ctx.objective][0]]
        return value * (float(rng.lognormal(0, 0.08)) if rng is not None else 1.0)

    def all_metrics(self, mix: dict[str, float], ctx: Context, rng: np.random.Generator) -> dict[str, float]:
        q = self.quality(mix, ctx)
        noise = lambda: float(rng.lognormal(0, 0.08))  # noqa: E731
        return {"roi": round(0.8 * math.exp(2.2 * q) * noise(), 4), "ctr": round(min(0.9, 0.008 * math.exp(2.0 * q) * noise()), 4),
                "conversion_rate": round(min(0.9, 0.02 * math.exp(2.0 * q) * noise()), 4), "cpl": round(40.0 / math.exp(2.0 * q) * noise(), 3)}

    def sample_good_mix(self, ctx: Context, rng: np.random.Generator, gamma: float = 3.0) -> dict[str, float]:
        """Tenants tend to pick reasonable mixes: channel choice is biased toward effective channels (so shared aggregates carry signal)."""
        eff = self.effectiveness(ctx)
        k = int(rng.integers(3, 6))
        p = np.exp(gamma * eff); p /= p.sum()
        chans = rng.choice(len(CHANNEL_VOCAB), size=k, replace=False, p=p)
        shares = rng.dirichlet(np.ones(k) * 2.0)
        return {CHANNEL_VOCAB[i]: float(round(s, 4)) for i, s in zip(chans, shares)}


# ================================================================================================ learned simulator
def featurize(mix: dict[str, float], ctx: Context) -> np.ndarray:
    total = sum(mix.values()) or 1.0
    f = [mix.get(c, 0.0) / total for c in CHANNEL_VOCAB]
    f += [1.0 if ctx.business_model == "B2B" else 0.0, math.log10(max(ctx.budget, 1.0))]
    f += [1.0 if ctx.industry == i else 0.0 for i in _INDUSTRIES] + [1.0 if ctx.region == r else 0.0 for r in _REGIONS]
    return np.array(f)


class OutcomeSimulator:
    """One GradientBoostingRegressor per objective, trained on noisy samples from the hidden world (a stand-in for a campaign log)."""

    def __init__(self, world: World, seed: int = 0, n_train: int = 12000) -> None:
        self.world, self.models, self.r2 = world, {}, {}
        rng = np.random.default_rng(seed)
        for obj in OBJECTIVES:
            X, y = [], []
            for _ in range(n_train + 1000):
                ctx = Context(str(rng.choice(["B2B", "B2C"])), obj, str(rng.choice(_INDUSTRIES)), str(rng.choice(_REGIONS)), float(10 ** rng.uniform(2.7, 5.0)))
                k = int(rng.integers(2, 7))
                chans = rng.choice(len(CHANNEL_VOCAB), size=k, replace=False)
                mix = {CHANNEL_VOCAB[i]: float(s) for i, s in zip(chans, rng.dirichlet(np.ones(k)))}
                X.append(featurize(mix, ctx))
                y.append(math.log(world.metric(mix, ctx, rng)))          # model log-metric (multiplicative noise)
            X, y = np.array(X), np.array(y)
            m = GradientBoostingRegressor(n_estimators=450, max_depth=6, learning_rate=0.05, subsample=0.8, random_state=seed)
            m.fit(X[:n_train], y[:n_train])
            self.models[obj] = m
            self.r2[obj] = round(float(m.score(X[n_train:], y[n_train:])), 4)      # held-out R^2 of the simulator itself

    def predict(self, mix: dict[str, float], ctx: Context) -> float:
        return float(math.exp(self.models[ctx.objective].predict(featurize(mix, ctx).reshape(1, -1))[0]))

    def uplift(self, mix: dict[str, float], reference: dict[str, float], ctx: Context) -> float:
        """Predicted relative improvement of `mix` over `reference` on the objective's primary metric (cpl: lower is better)."""
        lower = PRIMARY[ctx.objective][1]
        a, b = self.predict(mix, ctx), self.predict(reference, ctx)
        return (b - a) / b if lower else (a - b) / b

    def true_uplift(self, mix: dict[str, float], reference: dict[str, float], ctx: Context) -> float:
        lower = PRIMARY[ctx.objective][1]
        a, b = self.world.metric(mix, ctx), self.world.metric(reference, ctx)
        return (b - a) / b if lower else (a - b) / b
