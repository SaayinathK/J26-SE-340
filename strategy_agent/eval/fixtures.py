"""Synthetic tenants with PII deliberately planted in their free text, used by the tests, the demo and the privacy evaluation.

Every tenant gets unique fictional identifiers (business, brand, product, competitor, a contact person, email, phone, URL and an
exact budget). The privacy tests then try to find any of them in the shared store: finding one is a failure.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, Optional

import numpy as np

from ..db.tenant_store import TenantStore
from ..auth import TenantContext

_WORDS = ["Zephyr", "Quillon", "Marlowe", "Tavish", "Brindle", "Cobalt", "Ember", "Fenwick", "Galloway", "Harrowgate", "Ivorine",
          "Juniper", "Kestrel", "Lumora", "Mirabel", "Norvane", "Oakhurst", "Pelham", "Quorra", "Ravenel"]
_FIRST = ["Priya", "Nimal", "Anjali", "Dilshan", "Sara", "Marcus", "Elena", "Tomas", "Aisha", "Kavindu"]
_LAST = ["Fernando", "Perera", "Whitlock", "Okafor", "Lindqvist", "Moreau", "Haddad", "Ranasinghe", "Castellano", "Tan"]
_MESSAGES = [
    "{brand} sale: 20% discount this week, limited time only! Call {person} on {phone} or email {email}. See {url}. Better than {competitor}.",
    "Try {product} free for 30 days, money back guarantee. Questions? {person}, {email}, {phone}. {url}. Why settle for {competitor}?",
    "Join thousands of happy customers of {business}. Reviews at {url}. Contact {person} ({email}).",
    "Premium quality {product} from {brand}, crafted with care. Book a demo: {phone}. {url}",
]
_CHANNELS = ["meta_ads", "google_ads", "email", "social", "seo", "content_marketing", "influencer", "sms"]
OBJECTIVES = ("lead_gen", "awareness", "retention", "sales")


@dataclass
class TenantSpec:
    tenant_id: str
    industry: str = "retail"
    region: str = "Colombo, Sri Lanka"
    monthly_budget: float = 4237.0
    objective: str = "sales"
    n_campaigns: int = 4
    business_model: str = "B2C"
    extra: dict = field(default_factory=dict)


def seed_tenant(store: TenantStore, spec: TenantSpec, rng: np.random.Generator, index: int = 0,
                campaign_fn: Optional[Callable[[TenantSpec, np.random.Generator], tuple[dict, dict]]] = None) -> dict:
    """Create a tenant profile plus historical completed campaigns. Returns the planted identifiers, for leak checks."""
    word = _WORDS[index % len(_WORDS)] + (str(index // len(_WORDS)) if index >= len(_WORDS) else "")
    person = f"{_FIRST[index % len(_FIRST)]} {_LAST[(index * 3) % len(_LAST)]}"
    ids = {
        "tenant_id": spec.tenant_id,
        "business": f"{word} Holdings Pvt Ltd",
        "brand": f"{word}",
        "product": f"{word} Gold",
        "competitor": f"Rival{word}Corp",
        "person": person,
        "email": f"{person.split()[0].lower()}.{word.lower()}@{word.lower()}mail.com",
        "phone": f"+94 77 {rng.integers(100, 999)} {rng.integers(1000, 9999)}",
        "url": f"https://www.{word.lower()}-shop.com/offers",
        "budget": f"{spec.monthly_budget:g}",
    }
    repo = store.scoped(TenantContext(spec.tenant_id, f"admin-{spec.tenant_id}", ("tenant_admin",)))
    repo.upsert_profile({"industry": spec.industry, "business_name": ids["business"], "brand_names": [ids["brand"]],
                         "product_names": [ids["product"]], "competitor_names": [ids["competitor"]]})
    for i in range(spec.n_campaigns):
        if campaign_fn is not None:
            mix, outcome = campaign_fn(spec, rng)
        else:
            chosen = list(rng.choice(_CHANNELS, size=int(rng.integers(2, 5)), replace=False))
            shares = rng.dirichlet(np.ones(len(chosen)))
            mix = {ch: float(round(s, 4)) for ch, s in zip(chosen, shares)}
            outcome = {"impressions": float(rng.integers(50_000, 500_000)), "ctr": float(round(rng.uniform(0.01, 0.05), 4)),
                       "cpl": float(round(rng.uniform(6, 25), 2)), "roi": float(round(rng.uniform(0.8, 4.0), 2)),
                       "conversion_rate": float(round(rng.uniform(0.01, 0.08), 4)), "spend": spec.monthly_budget}
        mix = {**mix, f"{ids['brand']}Newsletter": 0.0}  # a custom channel name that carries the brand: must be generalised away
        text = _MESSAGES[(index + i) % len(_MESSAGES)].format(**ids)
        repo.add_campaign(industry=spec.industry, region=spec.region, objective=spec.objective, monthly_budget=spec.monthly_budget,
                          channel_mix=mix, business_model=spec.business_model, duration_weeks=int(rng.integers(4, 13)),
                          messaging_text=text, outcome=outcome, period_date=f"2026-0{int(rng.integers(1, 9))}-1{int(rng.integers(0, 9))}")
    return ids


def seed_world(store: TenantStore, groups: list[tuple[str, int, dict]], seed: int = 7) -> dict[str, dict]:
    """groups = [(prefix, n_tenants, spec_kwargs), ...]. Tenants in a group share quasi-identifiers (so a group can reach k)."""
    rng = np.random.default_rng(seed)
    world: dict[str, dict] = {}
    index = 0
    for prefix, n, kwargs in groups:
        for j in range(n):
            tid = f"{prefix}-{j + 1}"
            world[tid] = seed_tenant(store, TenantSpec(tenant_id=tid, **{**kwargs, "monthly_budget": kwargs.get("monthly_budget", 4237.0) + j}), rng, index)
            index += 1
    return world
