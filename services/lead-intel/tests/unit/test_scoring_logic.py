# services/lead-intel/tests/unit/test_scoring_logic.py — the scoring rules and calculations (O2, FR2, FR3, FR9)
import numpy as np
import pandas as pd
import pytest

from services.features import CATEGORICAL, NUMERIC, add_features
from services.scoring import B, EXPLAINER, PREP, confidence, explain, score_lead, segment

BASE = {"lead_id": "L-logic", "source": "Google", "lead_origin": "Landing Page Submission",
        "last_activity": "Email Opened", "occupation": "Working Professional",
        "specialization": "Business Administration", "total_visits": 4, "time_on_site_sec": 600, "pages_per_visit": 3}


@pytest.mark.parametrize("score,group", [(0, "cold"), (39, "cold"), (40, "warm"), (69, "warm"), (70, "hot"), (100, "hot")])
def test_group_boundaries(score, group):            # FR3: cold < 40 <= warm < 70 <= hot
    assert segment(score) == group


@pytest.mark.parametrize("score,level", [(70, "low"), (74, "low"), (75, "medium"), (84, "medium"), (85, "high"), (10, "high")])
def test_confidence_depends_on_distance_to_the_nearest_boundary(score, level):   # FR9
    c = confidence(score, segment(score))
    assert c["level"] == level and c["points_from_boundary"] == min(abs(score - 40), abs(score - 70))


def test_score_is_the_calibrated_probability_times_100():
    X = add_features(pd.DataFrame([BASE]))[NUMERIC + CATEGORICAL]
    assert score_lead(BASE)["score"] == int(round(B["calibrated"].predict_proba(X)[0, 1] * 100))


def test_not_every_lead_is_hot():                   # the same form gives all three groups
    groups = {score_lead({**BASE, **kw})["segment"] for kw in (
        {}, {"occupation": "Unemployed"},
        {"occupation": None, "source": "Olark Chat", "lead_origin": "API", "last_activity": "Olark Chat Conversation",
         "total_visits": 0, "time_on_site_sec": 0, "pages_per_visit": 0})}
    assert groups == {"hot", "warm", "cold"}


def test_working_professionals_score_higher_than_unemployed():
    # in the CRM data 92% of working professionals bought vs 44% of unemployed leads
    assert score_lead(BASE)["score"] > score_lead({**BASE, "occupation": "Unemployed"})["score"]


def test_reasons_add_up_to_the_full_shap_explanation():
    X = add_features(pd.DataFrame([BASE]))[NUMERIC + CATEGORICAL]
    per_column = EXPLAINER.shap_values(PREP.transform(X))[0]
    per_feature = explain(X)
    assert set(per_feature) == set(NUMERIC + CATEGORICAL)
    assert sum(per_feature.values()) == pytest.approx(float(np.sum(per_column)), abs=1e-9)


def test_reasons_describe_the_leads_real_values():
    r = score_lead({**BASE, "last_activity": "Email Opened"})
    for f in r["top_factors"]:
        if f["feature"].startswith("cat__"):
            col = next(c for c in CATEGORICAL if f["feature"].startswith(f"cat__{c}_"))
            assert f["feature"] == f"cat__{col}_{BASE[col]}" and f["value"] == BASE[col]
    names = [f["feature"] for f in r["top_factors"]]
    assert "cat__last_activity_SMS Sent" not in names          # never explains with a value the lead does not have
    assert len(r["top_factors"]) == 3 and abs(r["top_factors"][0]["impact"]) >= abs(r["top_factors"][-1]["impact"])


def test_missing_job_is_explained_as_unknown():
    r = score_lead({**BASE, "occupation": None})
    jobs = [f for f in r["top_factors"] if "occupation" in f["feature"]]
    assert all(f["feature"] == "cat__occupation_Unknown" and f["value"] is None for f in jobs)
