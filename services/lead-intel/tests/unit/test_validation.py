# services/lead-intel/tests/unit/test_validation.py — wrong input is refused before it reaches the model
import pytest
from fastapi.testclient import TestClient

from main import app

client = TestClient(app)
H = {"X-Tenant-Id": "tenant_a"}
OK = {"lead_id": "L-valid01", "source": "Google", "occupation": "Student",
      "total_visits": 3, "time_on_site_sec": 300, "pages_per_visit": 2}


def post(**change):
    return client.post("/leads/score", json={**OK, **change}, headers=H)


def test_a_normal_lead_is_accepted():
    assert post().status_code == 200


@pytest.mark.parametrize("change", [
    {"total_visits": -1}, {"time_on_site_sec": -5}, {"pages_per_visit": -2},
    {"total_visits": 5000}, {"time_on_site_sec": 999999},
    {"lead_id": ""}, {"lead_id": "L" * 65}, {"lead_id": "bad id with spaces"}, {"lead_id": "<script>"},
    {"source": "x" * 101},
])
def test_impossible_values_are_refused(change):
    assert post(**change).status_code == 422


def test_no_visits_means_no_time_and_no_pages():
    r = post(total_visits=0, time_on_site_sec=600, pages_per_visit=3)
    assert r.status_code == 422 and "0 website visits" in r.text
    assert post(total_visits=0, time_on_site_sec=0, pages_per_visit=0).status_code == 200


def test_visits_need_pages():
    assert post(total_visits=4, pages_per_visit=0).status_code == 422


def test_optional_fields_can_be_left_out():
    assert client.post("/leads/score", json={"lead_id": "L-valid02"}, headers=H).status_code == 200


def test_every_crm_record_passes_the_rules():
    from models.schemas import Lead
    from services.scoring import LEADS
    cols = ["total_visits", "time_on_site_sec", "pages_per_visit"]
    for r in LEADS[cols + ["contact_id"]].fillna({"time_on_site_sec": 0}).itertuples(index=False):
        Lead(lead_id=r.contact_id, total_visits=None if r.total_visits != r.total_visits else r.total_visits,
             time_on_site_sec=r.time_on_site_sec,
             pages_per_visit=None if r.pages_per_visit != r.pages_per_visit else r.pages_per_visit)
