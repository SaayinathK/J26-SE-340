# services/lead-intel/c3_08_examples.py  — C3-08 evidence: one recommendation per segment
import json
import requests
from app import LEADS, score_lead

API = "http://localhost:3001"
TENANT = "tenant_a"
wanted, examples = {"hot", "warm", "cold"}, {}

for r in LEADS[LEADS.tenant == TENANT].to_dict("records"):
    seg = score_lead({**r, "lead_id": r["contact_id"]})["segment"]   # fast: no LLM
    if seg in wanted:
        wanted.discard(seg)
        print(f"{seg}: {r['contact_id']} - asking Mistral (30-90 s)...")
        rec = requests.get(f"{API}/leads/{r['contact_id']}/recommendation",
                           headers={"X-Tenant-Id": TENANT}, timeout=300).json()
        examples[seg] = rec
        print(f"   grounded={rec['grounded']}  policy={rec.get('policy_check')}  "
              f"action={rec.get('next_best_action')}")
    if not wanted:
        break

with open("reports/c3-08_examples.json", "w", encoding="utf-8") as f:
    json.dump(examples, f, indent=2)
print("Saved reports/c3-08_examples.json")
