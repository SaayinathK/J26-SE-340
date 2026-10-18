from __future__ import annotations

import pytest

from strategy_agent.auth import TenantContext
from strategy_agent.config import Settings
from strategy_agent.db.shared_store import SharedStore
from strategy_agent.db.tenant_store import TenantStore


@pytest.fixture
def settings(tmp_path) -> Settings:
    return Settings(
        tenant_db_path=str(tmp_path / "tenant.sqlite"),
        shared_db_path=str(tmp_path / "shared.sqlite"),
        allow_dev_auth=True,
        generator_backend="template",
        rag_backend="tfidf",
        k_anonymity=3,
    )


@pytest.fixture
def tenant_store(settings) -> TenantStore:
    return TenantStore(settings.resolve(settings.tenant_db_path))


@pytest.fixture
def shared_store(settings) -> SharedStore:
    return SharedStore(settings.resolve(settings.shared_db_path))


def ctx(tenant_id: str, roles: tuple[str, ...] = ("tenant_admin",)) -> TenantContext:
    return TenantContext(tenant_id=tenant_id, user_id=f"user-{tenant_id}", roles=roles)


from strategy_agent.privacy.anonymizer import Anonymizer  # noqa: E402
from strategy_agent.privacy.consent import update_consent  # noqa: E402
from strategy_agent.privacy.pipeline import ConsentGatedPipeline  # noqa: E402
from strategy_agent.schemas import ALL_SCOPES, ConsentUpdate  # noqa: E402


@pytest.fixture(scope="session")
def anonymizer() -> Anonymizer:
    return Anonymizer()  # loads spaCy once for the whole test session


@pytest.fixture
def pipeline(tenant_store, shared_store, anonymizer, settings) -> ConsentGatedPipeline:
    return ConsentGatedPipeline(tenant_store, shared_store, anonymizer, settings, noise_seed=1)


def opt_in(pipeline: ConsentGatedPipeline, tenant_id: str, scopes=ALL_SCOPES):
    c = ctx(tenant_id)
    return update_consent(pipeline.tenants.scoped(c), c, ConsentUpdate(opted_in=True, scopes=list(scopes)), pipeline)


def opt_out(pipeline: ConsentGatedPipeline, tenant_id: str):
    c = ctx(tenant_id)
    return update_consent(pipeline.tenants.scoped(c), c, ConsentUpdate(opted_in=False), pipeline)
