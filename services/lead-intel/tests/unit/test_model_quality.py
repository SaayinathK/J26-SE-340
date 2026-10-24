# services/lead-intel/tests/unit/test_model_quality.py — accuracy on leads the model never saw (O2 validation)
import json

import pytest
from fastapi.testclient import TestClient
from sklearn.metrics import roc_auc_score

from config import settings
from main import app
from services.features import split
from services.quality import held_out_leads
from services.scoring import LEADS

client = TestClient(app)


@pytest.fixture(scope="module")
def q():
    return client.get("/leads/model-quality", headers={"X-Tenant-Id": "tenant_a"}).json()


def test_tested_only_on_unseen_leads():
    train, val, test = split(LEADS)
    assert not set(test.contact_id) & set(train.contact_id)
    assert not set(test.contact_id) & set(val.contact_id)
    assert set(held_out_leads().contact_id) == set(test.contact_id)


def test_meets_the_objective_target(q):            # O2: AUC >= 0.80 and better than the rule-based baseline
    a = q["all_tenants"]
    assert a["auc"] >= 0.80 and a["auc"] > q["rule_baseline_auc"]


def test_numbers_match_an_independent_recompute(q):
    t = held_out_leads()
    assert q["all_tenants"]["leads"] == len(t)
    assert q["all_tenants"]["auc"] == round(roc_auc_score(t.converted, t.p), 3)
    c = q["all_tenants"]["confusion"]
    assert sum(c.values()) == len(t)
    assert q["all_tenants"]["accuracy"] == round((c["bought_and_predicted"] + c["not_bought_and_not_predicted"]) / len(t), 3)


def test_numbers_match_the_saved_evaluation_report(q):
    f = settings.REPORTS_DIR / "c3-accuracy_check.json"
    saved = json.load(open(f))["part_b_test_all_tenants"]
    a = q["all_tenants"]
    assert (a["auc"], a["accuracy"], a["precision"], a["recall"]) == (
        saved["auc"], saved["accuracy_at_50"], saved["precision_at_50"], saved["recall_at_50"])


def test_scores_are_calibrated(q):                  # a score of 60 should mean about 60% bought
    for s, v in q["all_tenants"]["segments"].items():
        assert abs(v["avg_score"] / 100 - v["bought_rate"]) <= q["targets"]["calibration_gap"], s


def test_groups_are_ordered(q):
    seg = q["all_tenants"]["segments"]
    assert seg["hot"]["bought_rate"] > seg["warm"]["bought_rate"] > seg["cold"]["bought_rate"]


def test_tenant_view_is_only_that_tenant(q):
    t = held_out_leads()
    assert q["this_tenant"]["leads"] == int((t.tenant == "tenant_a").sum())
    assert client.get("/leads/model-quality", headers={"X-Tenant-Id": "tenant_x"}).status_code == 404
