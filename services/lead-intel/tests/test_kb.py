# services/lead-intel/tests/test_kb.py  — C3-07 knowledge base checks
import json
from pathlib import Path
import pandas as pd
from kb import PII, lead_text, KB_DIR

LEAD = {"source": "Google", "lead_origin": "Landing Page Submission", "occupation": "Working Professional",
        "specialization": None, "total_visits": 5, "time_on_site_sec": 1240,
        "pages_per_visit": 2.6666666666666665, "last_activity": "Email Opened",
        "tags": [], "converted": 1}

def test_pii_check_blocks_emails_and_phones_but_not_decimals():
    assert PII.search("contact me at someone@example.com")
    assert PII.search("call +94 77 123 4567")
    assert not PII.search(lead_text(LEAD))          # long decimal is not a phone number

def test_query_text_hides_the_outcome():
    assert "Outcome" in lead_text(LEAD, with_outcome=True)
    assert "Outcome" not in lead_text(LEAD, with_outcome=False)

def test_each_tenant_has_its_own_kb_with_only_its_own_leads():
    leads = pd.read_json("data/processed/leads_ghl.jsonl", lines=True)
    for t in ["tenant_a", "tenant_b", "tenant_c"]:
        f = KB_DIR / f"{t}_docs.jsonl"
        if not f.exists():
            continue                                   # tenant not built yet
        docs = [json.loads(l) for l in open(f, encoding="utf-8")]
        ids = {d["contact_id"] for d in docs if d["type"] == "lead_profile"}
        assert ids == set(leads[leads.tenant == t].contact_id)   # no other tenant's leads
        assert all(not PII.search(d["text"]) for d in docs)