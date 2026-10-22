# ml/lead-intel/training/outcome_replay.py  — FR7 evidence: replay real outcomes of held-out leads
# For tenant_a's TEST-split leads (never used in training): score each one through the API,
# then record its real outcome (won/lost) and read GET /leads/monitoring.
# Uses a separate, temporary history so the demo data of the running API is not touched.
# Run:  python ml/lead-intel/training/outcome_replay.py      (about 1 minute, no Ollama needed)
import json
import os
import tempfile

os.environ["C3_STATE_DIR"] = tempfile.mkdtemp(prefix="c3-replay-")
os.environ["C3_DATABASE_URL"] = ""

import pandas as pd                              # noqa: E402
from fastapi.testclient import TestClient        # noqa: E402
import _paths  # noqa: F401,E402
from config import settings                     # noqa: E402
from main import app                             # noqa: E402
from services.features import split              # noqa: E402
from services.scoring import LEADS               # noqa: E402

client = TestClient(app)
H = {"X-Tenant-Id": "tenant_a"}
test_ids = set(split(LEADS)[2].contact_id)
leads = LEADS[(LEADS.tenant == "tenant_a") & LEADS.contact_id.isin(test_ids)]
cols = ["source", "lead_origin", "last_activity", "occupation", "specialization",
        "total_visits", "time_on_site_sec", "pages_per_visit"]
for r in leads.to_dict("records"):
    body = {"lead_id": r["contact_id"], **{c: (None if pd.isna(r[c]) else r[c]) for c in cols}}
    body["time_on_site_sec"] = body["time_on_site_sec"] or 0
    client.post("/leads/score", json=body, headers=H)
    client.post(f"/leads/{r['contact_id']}/outcome", json={"outcome": "won" if r["converted"] else "lost"}, headers=H)

m = client.get("/leads/monitoring", headers=H).json()
m["note"] = "tenant_a test-split leads (held out from training), real outcomes replayed through the API"
json.dump(m, open(settings.REPORTS_DIR / "c3-fr7_monitoring.json", "w"), indent=2)
print(json.dumps(m, indent=2))