# services/lead-intel/tests/unit/test_crm_match.py — a CRM lead gets the same score everywhere;
# typing different details for a CRM Lead ID gives a clearly marked "what-if" that is never saved.
from fastapi.testclient import TestClient

from main import app
from services.dashboard import scored_leads
from services.scoring import find_lead, score_lead

client = TestClient(app)
T = "tenant_a"
H = {"X-Tenant-Id": T}
FIELDS = ["source", "lead_origin", "last_activity", "occupation", "specialization",
          "total_visits", "time_on_site_sec", "pages_per_visit"]


def crm_body(lead_id):
    p = client.get(f"/leads/{lead_id}/profile", headers=H).json()
    return {"lead_id": lead_id, **{k: p[k] for k in FIELDS}}, p


def saved_scores(lead_id):
    return client.get(f"/leads/{lead_id}/history", headers=H).json()["counts"]["scores"]


def cold_lead():
    t = scored_leads(T)
    return t[t.segment == "cold"].sort_values("score", ascending=False).contact_id.iloc[0]


def test_list_score_equals_score_page_for_crm_leads():
    t = scored_leads(T).sample(300, random_state=7)
    for r in t.itertuples():
        assert score_lead(find_lead(T, r.contact_id))["score"] == r.score, r.contact_id


def test_form_round_trip_gives_the_list_score():      # profile -> form -> /score, for many leads
    for lead_id in scored_leads(T).sample(60, random_state=3).contact_id:
        body, p = crm_body(lead_id)
        r = client.post("/leads/score", json=body, headers=H).json()
        assert r["score"] == p["score"] and r["what_if"] is False, lead_id


def test_profile_returns_the_crm_record():
    lead_id = cold_lead()
    body, p = crm_body(lead_id)
    assert p["lead_id"] == lead_id and p["segment"] == "cold"
    assert client.get("/leads/L-does-not-exist/profile", headers=H).status_code == 404


def test_profile_of_another_tenant_is_hidden():
    other = scored_leads("tenant_b").contact_id.iloc[0]
    assert client.get(f"/leads/{other}/profile", headers=H).status_code == 404


def test_scoring_the_real_crm_details_matches_the_list_and_is_saved():
    lead_id = cold_lead()
    body, p = crm_body(lead_id)
    before = saved_scores(lead_id)
    r = client.post("/leads/score", json=body, headers=H).json()
    assert r["score"] == p["score"] and r["segment"] == "cold"
    assert r["what_if"] is False and r["crm"]["changed"] == []
    assert saved_scores(lead_id) == before + 1


def test_changed_details_are_a_what_if_and_are_not_saved():
    lead_id = cold_lead()
    body, p = crm_body(lead_id)
    client.post("/leads/score", json=body, headers=H)               # real score saved first
    before = saved_scores(lead_id)
    what_if = {**body, "occupation": "Working Professional", "last_activity": "Email Opened",
               "total_visits": 1, "time_on_site_sec": 600, "pages_per_visit": 1}
    r = client.post("/leads/score", json=what_if, headers=H).json()
    assert r["what_if"] is True and r["score"] != p["score"]
    assert r["crm"]["score"] == p["score"] and r["crm"]["segment"] == "cold"
    really_changed = {k for k in FIELDS if what_if[k] != body[k]}
    assert really_changed and {c["field"] for c in r["crm"]["changed"]} == really_changed
    assert r["alert"] is None and saved_scores(lead_id) == before   # history keeps only the real lead


def test_a_new_lead_id_is_not_a_what_if():
    r = client.post("/leads/score", json={"lead_id": "L-brand-new-01", "source": "Google"}, headers=H).json()
    assert r["crm"] is None and r["what_if"] is False
