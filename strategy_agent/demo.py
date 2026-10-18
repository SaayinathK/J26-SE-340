"""End-to-end walkthrough on temporary databases (nothing persists).   python -m strategy_agent.demo

Six synthetic businesses in the same market share anonymised insights (five consent, one does not); a seventh, brand-new business then
asks for a strategy and benefits from them; it reports an outcome; one business revokes consent. Every number printed is real output.
"""
from __future__ import annotations

import copy
import tempfile
from pathlib import Path

from fastapi.testclient import TestClient

from .api.main import create_app
from .config import Settings
from .eval.attacks import appears
from .eval.fixtures import seed_world

H = lambda t, roles="tenant_admin": {"X-Dev-Tenant": t, "X-Dev-Roles": roles, "X-Dev-User": f"admin-{t}"}  # noqa: E731
SCOPES = ["channel_mix", "budget_split", "outcome_metrics", "messaging_angles", "timeline"]
BRIEF = {"business_profile": {"industry": "retail", "business_model": "B2C", "target_audience": "young professionals", "region": "Colombo, Sri Lanka",
                              "brand_tone": "friendly", "monthly_budget": 4300, "business_name": "Newcomer Goods", "brand_names": ["Newcomer"]},
         "objective": {"type": "sales", "target_kpi": "roi", "target_value": 3.0, "time_horizon": "8 weeks"},
         "constraints": {"channels_blocked": ["sms"]}}


def step(n: int, text: str) -> None:
    print(f"\n[{n}] {text}")


def main() -> None:
    work = Path(tempfile.mkdtemp(prefix="strategy_agent_demo_"))
    settings = Settings(tenant_db_path=str(work / "t.sqlite"), shared_db_path=str(work / "s.sqlite"), k_anonymity=3, generator_backend="template", rag_backend="tfidf")
    client = TestClient(create_app(settings, use_default_generators=False))
    app = client.app

    step(1, "Six businesses (retail / Colombo / sales) have past campaigns. Their free text contains planted emails, phones, brand and competitor names.")
    world = seed_world(app.state.tenant_store, [("shop", 6, {"industry": "retail", "region": "Colombo, Sri Lanka", "objective": "sales", "monthly_budget": 4200.0})])
    print(f"    tenants: {', '.join(world)}")

    step(2, "Five tenant admins opt in to sharing (all scopes). shop-6 does not. A marketer (non-admin) tries to change consent:")
    r = client.put("/v1/strategy/sharing/consent", json={"opted_in": True, "scopes": SCOPES}, headers=H("shop-1", "marketer"))
    print(f"    marketer -> HTTP {r.status_code} ({r.json()['detail']})")
    for t in list(world)[:5]:
        client.put("/v1/strategy/sharing/consent", json={"opted_in": True, "scopes": SCOPES}, headers=H(t))
    r = client.put("/v1/strategy/sharing/consent", json={"opted_in": True, "scopes": SCOPES, "tenant_id": "someone-else"}, headers=H("shop-1"))
    print(f"    a body carrying a tenant_id -> HTTP {r.status_code} ({r.json()['detail']})")

    step(3, "Nightly job: anonymise, generalise, k-gate (k=3) and publish.")
    print(f"    {app.state.pipeline.run_batch()}")
    insights = client.get("/v1/strategy/shared-insights", headers=H("newcomer")).json()
    for i in insights:
        print(f"    published: {i['summary']}")
    text = app.state.pipeline.shared.dump_all_text()
    leaked = [(t, k) for t, ids in world.items() for k in ("email", "phone", "brand", "competitor", "person", "tenant_id") if appears(ids[k].split()[0] if k in ("brand", "competitor", "person") else ids[k], text)]
    print(f"    planted identifiers found in the shared store: {len(leaked)}")

    step(4, "A brand-new business (no history) asks for strategies, once without and once with the shared insights.")
    cold = client.post("/v1/strategy/generate", json={**copy.deepcopy(BRIEF), "use_shared_insights": False}, headers=H("newcomer")).json()
    warm = client.post("/v1/strategy/generate", json={**copy.deepcopy(BRIEF), "use_shared_insights": True}, headers=H("newcomer")).json()
    show = lambda res: ", ".join(f"{c['channel']} {c['budget_share']:.0%}" for c in res["strategies"][0]["channels"])  # noqa: E731
    print(f"    without insights -> {cold['strategies'][0]['title']}: {show(cold)}")
    print(f"    with insights    -> {warm['strategies'][0]['title']}: {show(warm)}")
    print(f"    evidence used: {len(warm['evidence_ids']['shared_insights'])} shared insight(s); model_version={warm['model_version']}, generator={warm['generator_used']}")
    top = warm["ranking"]["scores"][warm["strategies"][0]["strategy_id"]]
    print(f"    rank-1 score breakdown: {top}")

    step(5, "The newcomer accepts the top strategy and later reports the real outcome.")
    rid = warm["recommendation_id"]
    fb = client.post(f"/v1/strategy/{rid}/feedback", json={"decision": "accepted", "rating": 5, "comment": "worked well"}, headers=H("newcomer")).json()
    out = client.post(f"/v1/strategy/{rid}/outcome", json={"impressions": 180000, "roi": 3.4, "ctr": 0.03, "conversion_rate": 0.04, "cpl": 9.5, "spend": 4300, "period": "2026-08-01"}, headers=H("newcomer")).json()
    print(f"    feedback -> reward {fb['reward']}, preference pairs {fb['preference_pairs_created']}")
    print(f"    outcome  -> metric {out['primary_metric']}, baseline {out['baseline']}, uplift {out['uplift']}, reward {out['reward']}, sharing: {out['contribution_status']}")

    step(6, "shop-1 and shop-2 revoke their consent. With only 3 contributors left the insight still stands; after one more it must disappear.")
    for t in ("shop-1", "shop-2", "shop-3"):
        client.put("/v1/strategy/sharing/consent", json={"opted_in": False}, headers=H(t))
        n = len(client.get("/v1/strategy/shared-insights", headers=H("newcomer")).json())
        print(f"    after {t} revoked: {n} insight(s) published, {app.state.pipeline.shared.count_contributions()} contributions stored")
    print("\nDone. Temporary databases:", work)


if __name__ == "__main__":
    main()
