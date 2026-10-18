"""Phase 0: the tenant comes from the token; tenant_id in a request is refused; config is safe outside dev."""
from __future__ import annotations

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from pydantic import BaseModel, ValidationError

from strategy_agent.auth import TenantContext, create_token, get_tenant_context, reject_tenant_id_in_request, require_roles
from strategy_agent.config import Settings
from strategy_agent.schemas import GenerateRequest, Strategy


class _Echo(BaseModel):
    note: str = ""


def _client(settings: Settings) -> TestClient:
    app = FastAPI(dependencies=[Depends(reject_tenant_id_in_request)])
    app.state.settings = settings

    @app.get("/whoami")
    def whoami(ctx: TenantContext = Depends(get_tenant_context)):
        return {"tenant_id": ctx.tenant_id, "roles": list(ctx.roles)}

    @app.post("/echo")
    def echo(body: dict, ctx: TenantContext = Depends(get_tenant_context)):
        return {"tenant_id": ctx.tenant_id}

    @app.put("/admin-only")
    def admin(ctx: TenantContext = Depends(require_roles("tenant_admin"))):
        return {"ok": True}

    return TestClient(app)


def test_tenant_identity_comes_from_the_jwt(settings):
    c = _client(settings)
    token = create_token("tenant-a", "u1", ["tenant_admin"], settings)
    r = c.get("/whoami", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200 and r.json() == {"tenant_id": "tenant-a", "roles": ["tenant_admin"]}


def test_missing_bad_or_wrong_secret_token_is_401(settings):
    c = _client(settings)
    assert c.get("/whoami").status_code == 401
    assert c.get("/whoami", headers={"Authorization": "Bearer not-a-token"}).status_code == 401
    forged = create_token("tenant-a", "u", [], Settings(jwt_secret="another-secret-value-long-enough-0123456789"))
    assert c.get("/whoami", headers={"Authorization": f"Bearer {forged}"}).status_code == 401


def test_dev_headers_work_only_when_dev_auth_is_allowed(settings):
    assert _client(settings).get("/whoami", headers={"X-Dev-Tenant": "t1", "X-Dev-Roles": "tenant_admin"}).json()["tenant_id"] == "t1"
    locked = settings.model_copy(update={"allow_dev_auth": False})
    assert _client(locked).get("/whoami", headers={"X-Dev-Tenant": "t1"}).status_code == 401


@pytest.mark.parametrize("body", [{"tenant_id": "evil"}, {"nested": {"tenantId": "evil"}}, {"items": [{"Tenant_ID": "x"}]}])
def test_tenant_id_in_body_is_rejected_at_any_depth(settings, body):
    r = _client(settings).post("/echo", json=body, headers={"X-Dev-Tenant": "t1"})
    assert r.status_code == 400 and "tenant_id" in r.json()["detail"]


def test_tenant_id_in_query_string_is_rejected(settings):
    assert _client(settings).get("/whoami?tenant_id=evil", headers={"X-Dev-Tenant": "t1"}).status_code == 400


def test_role_gate(settings):
    c = _client(settings)
    assert c.put("/admin-only", headers={"X-Dev-Tenant": "t1", "X-Dev-Roles": "marketer"}).status_code == 403
    assert c.put("/admin-only", headers={"X-Dev-Tenant": "t1", "X-Dev-Roles": "tenant_admin"}).status_code == 200


def test_request_schema_has_no_tenant_field_and_forbids_extras():
    assert "tenant_id" not in GenerateRequest.model_fields
    payload = {"business_profile": {"industry": "retail", "business_model": "B2C", "target_audience": "x", "region": "LK", "monthly_budget": 10},
               "objective": {"type": "sales", "target_kpi": "roi", "target_value": 2}, "tenant_id": "evil"}
    with pytest.raises(ValidationError):
        GenerateRequest(**payload)


def test_strategy_budget_shares_must_sum_to_one():
    base = dict(title="t", summary="s", audience_segments=["a"], messaging_angles=["m"], timeline=[{"week": 1, "actions": ["x"]}],
                kpis=[{"name": "ctr", "target": 0.02}], expected_uplift={"metric": "roi", "low": 0.1, "high": 0.3}, rationale="r", confidence=0.7)
    Strategy(channels=[{"channel": "email", "budget_share": 0.5}, {"channel": "meta_ads", "budget_share": 0.5}], **base)
    with pytest.raises(ValidationError):
        Strategy(channels=[{"channel": "email", "budget_share": 0.5}, {"channel": "meta_ads", "budget_share": 0.2}], **base)


def test_config_refuses_unsafe_settings_outside_dev():
    with pytest.raises(ValidationError):
        Settings(app_env="prod", allow_dev_auth=True, jwt_secret="x" * 40)
    with pytest.raises(ValidationError):
        Settings(app_env="prod", allow_dev_auth=False)  # default secret
    Settings(app_env="prod", allow_dev_auth=False, jwt_secret="a-real-long-random-secret-value-1234567890")
