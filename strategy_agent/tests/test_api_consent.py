"""Phase 1 API: consent endpoints (tenant_admin only), shared-insights endpoint, tenant_id refusal."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from strategy_agent.api.main import create_app
from strategy_agent.eval.fixtures import seed_world
from strategy_agent.schemas import SharedInsight

ADMIN = lambda t: {"X-Dev-Tenant": t, "X-Dev-Roles": "tenant_admin", "X-Dev-User": f"admin-{t}"}  # noqa: E731
MARKETER = lambda t: {"X-Dev-Tenant": t, "X-Dev-Roles": "marketer"}  # noqa: E731
GROUP = ("shop", 3, {"industry": "retail", "region": "Colombo, Sri Lanka", "objective": "sales"})


@pytest.fixture
def client(settings):
    return TestClient(create_app(settings))


def test_health_needs_no_auth(client):
    assert client.get("/health").json()["status"] == "ok"


def test_consent_defaults_to_not_opted_in(client):
    r = client.get("/v1/strategy/sharing/consent", headers=ADMIN("shop-1"))
    assert r.status_code == 200 and r.json()["opted_in"] is False and r.json()["scopes"] == []


def test_only_tenant_admin_can_read_or_write_consent(client):
    assert client.get("/v1/strategy/sharing/consent", headers=MARKETER("shop-1")).status_code == 403
    r = client.put("/v1/strategy/sharing/consent", json={"opted_in": True, "scopes": ["channel_mix"]}, headers=MARKETER("shop-1"))
    assert r.status_code == 403
    assert client.get("/v1/strategy/sharing/consent").status_code == 401


def test_consent_validation(client):
    h = ADMIN("shop-1")
    assert client.put("/v1/strategy/sharing/consent", json={"opted_in": True, "scopes": []}, headers=h).status_code == 422
    assert client.put("/v1/strategy/sharing/consent", json={"opted_in": True, "scopes": ["everything"]}, headers=h).status_code == 422
    r = client.put("/v1/strategy/sharing/consent", json={"opted_in": True, "scopes": ["channel_mix"], "tenant_id": "evil"}, headers=h)
    assert r.status_code == 400 and "tenant_id" in r.json()["detail"]


def test_consent_is_recorded_with_who_granted_it_taken_from_the_token(client):
    r = client.put("/v1/strategy/sharing/consent", json={"opted_in": True, "scopes": ["channel_mix", "outcome_metrics"]}, headers=ADMIN("shop-1"))
    body = r.json()
    assert r.status_code == 200 and body["opted_in"] is True and body["granted_by"] == "admin-shop-1" and body["granted_at"]
    assert sorted(body["scopes"]) == ["channel_mix", "outcome_metrics"]
    assert client.get("/v1/strategy/sharing/consent", headers=ADMIN("shop-2")).json()["opted_in"] is False   # another tenant is unaffected


def test_end_to_end_share_publish_read_and_revoke_through_the_api(client):
    app = client.app
    seed_world(app.state.tenant_store, [GROUP])
    for t in ("shop-1", "shop-2", "shop-3"):
        assert client.put("/v1/strategy/sharing/consent", json={"opted_in": True, "scopes": ["channel_mix", "budget_split", "outcome_metrics", "messaging_angles", "timeline"]}, headers=ADMIN(t)).status_code == 200
    app.state.pipeline.run_batch()

    rows = client.get("/v1/strategy/shared-insights", headers=MARKETER("some-other-tenant")).json()
    assert len(rows) == 1 and rows[0]["support_count"] == 3
    assert set(rows[0]) == set(SharedInsight.model_fields)                       # exactly the published fields, nothing extra
    assert "shop-" not in str(rows) and "tenant" not in str(rows).lower()
    assert client.get("/v1/strategy/shared-insights?objective=lead_gen", headers=MARKETER("x")).json() == []
    assert client.get("/v1/strategy/shared-insights").status_code == 401

    assert client.put("/v1/strategy/sharing/consent", json={"opted_in": False}, headers=ADMIN("shop-3")).json()["opted_in"] is False
    assert client.get("/v1/strategy/shared-insights", headers=MARKETER("x")).json() == []   # support fell below k=3


def test_tenant_id_in_query_string_of_insights_is_rejected(client):
    assert client.get("/v1/strategy/shared-insights?tenant_id=shop-1", headers=MARKETER("x")).status_code == 400
