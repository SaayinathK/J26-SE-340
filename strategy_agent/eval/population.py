"""A synthetic population of tenants whose campaigns come from the hidden world, with planted PII and partial consent."""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from ..auth import TenantContext
from ..db.tenant_store import TenantStore
from ..privacy.anonymizer import budget_band, industry_bucket, region_bucket
from .fixtures import TenantSpec, seed_tenant
from .simulator import Context, World

INDUSTRIES = [("retail", "B2C"), ("SaaS", "B2B"), ("education", "B2C"), ("healthcare clinic", "B2C"), ("restaurant", "B2C")]
OBJECTIVES = ("sales", "lead_gen")
REGIONS = ("Colombo, Sri Lanka", "London, UK")
SCOPES = ["channel_mix", "budget_split", "outcome_metrics", "messaging_angles", "timeline"]


@dataclass
class Population:
    specs: dict[str, TenantSpec]
    identifiers: dict[str, dict]
    consenting: set[str]

    def qi_of(self, tenant_id: str) -> tuple:
        s = self.specs[tenant_id]
        return (industry_bucket(s.industry), region_bucket(s.region), budget_band(s.monthly_budget), s.objective)

    def contributors_by_qi(self) -> dict[tuple, set[str]]:
        out: dict[tuple, set[str]] = {}
        for t in self.consenting:
            out.setdefault(self.qi_of(t), set()).add(t)
        return out

    def candidates_by_qi(self) -> dict[tuple, set[str]]:
        """What an attacker who knows every tenant's PUBLIC attributes can compute, consent or not."""
        out: dict[tuple, set[str]] = {}
        for t in self.specs:
            out.setdefault(self.qi_of(t), set()).add(t)
        return out


def build_population(store: TenantStore, world: World, n_tenants: int = 150, seed: int = 0, opt_in_rate: float = 0.75, campaigns: int = 3) -> Population:
    rng = np.random.default_rng(seed)
    groups = [(i, o, r) for i in INDUSTRIES for o in OBJECTIVES for r in REGIONS]
    weights = np.array([1.0 / (rank + 1) ** 1.1 for rank in range(len(groups))])   # skewed: a few big groups, a long tail of small ones
    weights /= weights.sum()
    specs: dict[str, TenantSpec] = {}
    identifiers: dict[str, dict] = {}
    consenting: set[str] = set()

    def campaign_fn(spec: TenantSpec, r: np.random.Generator):
        ctx = Context(spec.business_model, spec.objective, industry_bucket(spec.industry), region_bucket(spec.region), spec.monthly_budget)
        mix = world.sample_good_mix(ctx, r)
        return mix, {**world.all_metrics(mix, ctx, r), "spend": spec.monthly_budget, "impressions": float(r.integers(50_000, 500_000))}

    for i in range(n_tenants):
        (industry, bm), objective, region = groups[int(rng.choice(len(groups), p=weights))]
        budget = (2500.0 if rng.random() < 0.8 else 12000.0) + float(rng.integers(0, 400))
        spec = TenantSpec(tenant_id=f"pop-{i:03d}", industry=industry, region=region, monthly_budget=budget, objective=objective,
                          n_campaigns=campaigns, business_model=bm)
        identifiers[spec.tenant_id] = seed_tenant(store, spec, rng, index=i, campaign_fn=campaign_fn)
        specs[spec.tenant_id] = spec
        if rng.random() < opt_in_rate:
            repo = store.scoped(TenantContext(spec.tenant_id, "admin", ("tenant_admin",)))
            repo.get_or_create_contributor_token(rotate=True)
            repo.set_consent(opted_in=True, scopes=SCOPES, consent_version="v1", granted_by="admin", granted_at="2026-01-01T00:00:00+00:00", revoked_at=None)
            consenting.add(spec.tenant_id)
    return Population(specs, identifiers, consenting)
