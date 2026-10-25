# services/lead-intel/tests/integration/test_postgres_repo.py — the C3 database really isolates tenants
# Needs the lead-intel-database container (or any Postgres with db/migrations applied). Skipped otherwise.
# Run:  $env:C3_TEST_DATABASE_URL="postgresql://lead_intel_app:c3_local_dev_only_2026@127.0.0.1:5436/lead_intel"
#       python -m pytest -q tests/integration/test_postgres_repo.py
import os
import uuid

import pytest

URL = os.getenv("C3_TEST_DATABASE_URL", "")
pytestmark = pytest.mark.skipif(not URL, reason="set C3_TEST_DATABASE_URL to run the database tests")


@pytest.fixture()
def repo():
    from repositories.postgres_repo import PostgresHistoryRepo
    return PostgresHistoryRepo(URL)


def _score(score, segment="hot"):
    return {"score": score, "segment": segment, "top_factors": [{"feature": "x", "impact": 0.1}],
            "confidence": {"level": "high", "points_from_boundary": 20}, "alert": None,
            "model_version": "test", "source": "api"}


def test_history_is_appended_and_read_back(repo):
    lead = "L-db-" + uuid.uuid4().hex[:8]
    repo.add_score("tenant_a", lead, _score(80))
    repo.add_score("tenant_a", lead, _score(30, "cold"))
    repo.add_recommendation("tenant_a", lead, {"next_best_action": "Call", "grounded": True, "score": 30,
                                               "segment": "cold", "sources": [{"label": "S1", "type": "pattern",
                                                                               "text": "x"}]})
    repo.add_outcome("tenant_a", lead, {"outcome": "lost", "score": 30, "segment": "cold", "model_version": "test"})
    h = repo.lead_history("tenant_a", lead)
    assert [r["score"] for r in h["scores"]] == [80, 30]
    last = repo.last_score("tenant_a", lead)
    assert last["score"] == 30 and last["confidence"]["level"] == "high" and last["top_factors"][0]["feature"] == "x"
    assert h["recommendations"][0]["sources"][0]["label"] == "S1" and h["outcomes"][0]["outcome"] == "lost"
    assert any(x["lead_id"] == lead for x in repo.leads_summary("tenant_a"))


def test_row_level_security_hides_other_tenants(repo):
    lead = "L-db-" + uuid.uuid4().hex[:8]
    repo.add_score("tenant_a", lead, _score(90))
    assert repo.lead_history("tenant_b", lead)["scores"] == []
    assert repo.last_score("tenant_b", lead) is None


def test_database_refuses_a_row_for_another_tenant():
    import psycopg
    with pytest.raises(psycopg.errors.InsufficientPrivilege):          # RLS WITH CHECK
        with psycopg.connect(URL) as conn:
            conn.execute("SELECT set_config('app.current_tenant', 'tenant_a', true)")
            conn.execute("INSERT INTO lead_scores (tenant, lead_id, score, segment, model_version) "
                         "VALUES ('tenant_b', 'L-x', 50, 'warm', 'test')")


def test_no_tenant_set_means_no_rows():
    import psycopg
    with psycopg.connect(URL) as conn:
        assert conn.execute("SELECT count(*) FROM lead_scores").fetchone()[0] == 0
