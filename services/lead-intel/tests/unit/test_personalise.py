# services/lead-intel/tests/unit/test_personalise.py — talking points come from each lead's own data
from agent.kb import PII
from agent.personalise import talking_points
from services.scoring import LEADS

A = {"last_activity": "Email Opened", "total_visits": 6, "time_on_site_sec": 1500, "specialization": "Finance Management",
     "occupation": "Working Professional", "source": "Reference"}
B = {"last_activity": "Unreachable", "total_visits": 0, "time_on_site_sec": 0, "specialization": None,
     "occupation": "Student", "source": "Google"}


def test_two_different_leads_get_different_points():
    a, b = talking_points(A), talking_points(B)
    assert a != b and not set(a) & set(b)


def test_points_use_the_leads_facts():
    a = " ".join(talking_points(A))
    assert "email" in a.lower() and "25 minutes" in a and "Finance Management" in a
    b = " ".join(talking_points(B))
    assert "different time or channel" in b and "Has not spent time" in b


def test_missing_values_never_appear_as_words():
    p = " ".join(talking_points({"last_activity": None, "total_visits": float("nan"), "specialization": "Select"}))
    assert "None" not in p and "nan" not in p and "Select" not in p and "No activity yet" in p


def test_at_most_four_points_and_no_personal_data():
    for r in LEADS.head(300).to_dict("records"):
        pts = talking_points(r)
        assert 1 <= len(pts) <= 4 and not any(PII.search(x) for x in pts)


def test_points_vary_across_real_hot_leads():
    from services.dashboard import scored_leads
    hot = scored_leads("tenant_a").query("segment == 'hot'").head(50)
    distinct = {tuple(talking_points(r)) for r in hot.to_dict("records")}
    assert len(distinct) >= 20                        # not one template for every hot lead
