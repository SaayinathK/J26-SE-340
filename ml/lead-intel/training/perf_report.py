# ml/lead-intel/training/perf_report.py  — C3-13 latency evidence (NFR1: scoring + retrieval <= 1 s)
# Measures p50 / p95 on THIS machine and saves reports/c3-13_latency.csv.
# Run:  python ml/lead-intel/training/perf_report.py          (Ollama parts are skipped if Ollama is not running)
import time
import numpy as np
import pandas as pd
import requests
from fastapi.testclient import TestClient

import _paths  # noqa: F401
from agent import kb
from config import settings
from main import app
from services.features import NUMERIC, CATEGORICAL
from services.scoring import B, LEADS

client = TestClient(app)
H = {"X-Tenant-Id": "tenant_a"}
rows = []


def measure(name, fn, n):
    t = []
    for i in range(n):
        t0 = time.perf_counter()
        fn(i)
        t.append((time.perf_counter() - t0) * 1000)
    rows.append({"operation": name, "runs": n, "p50_ms": round(float(np.percentile(t, 50)), 1),
                 "p95_ms": round(float(np.percentile(t, 95)), 1), "max_ms": round(max(t), 1)})
    print(rows[-1])


leads = LEADS[LEADS.tenant == "tenant_a"].head(100)
payload = [{"lead_id": r.contact_id, "source": r.source if pd.notna(r.source) else None,
            "last_activity": r.last_activity if pd.notna(r.last_activity) else None,
            "occupation": r.occupation if pd.notna(r.occupation) else None,
            "total_visits": None if pd.isna(r.total_visits) else r.total_visits,
            "time_on_site_sec": r.time_on_site_sec,
            "pages_per_visit": None if pd.isna(r.pages_per_visit) else r.pages_per_visit}
           for r in leads.itertuples()]

measure("POST /leads/score", lambda i: client.post("/leads/score", json=payload[i], headers=H), 100)
measure("GET /leads/analytics", lambda i: client.get("/leads/analytics", headers=H), 20)
measure("GET /leads/dashboard", lambda i: client.get("/leads/dashboard", headers=H), 20)

# NFR2: at least 10,000 lead records without significant degradation
big = LEADS.sample(10_000, replace=True, random_state=42)[NUMERIC + CATEGORICAL]
measure("score 10,000 leads in one batch (NFR2)", lambda i: B["calibrated"].predict_proba(big), 3)

queries = [kb.lead_text(r, with_outcome=False) for r in leads.head(50).to_dict("records")]
if (kb.KB_DIR / "tenant_a_docs.jsonl").exists():
    measure("KB search bm25", lambda i: kb.search("tenant_a", queries[i], method="bm25"), 50)
    try:
        requests.get(kb.OLLAMA, timeout=3)
        for m in ["embedding", "hybrid"]:
            measure(f"KB search {m} (incl. query embedding)",
                    lambda i, m=m: kb.search("tenant_a", queries[i], method=m), 50)
    except requests.RequestException:
        print("Ollama not running - embedding search not measured")
else:
    print("KB not built - run build_kb.py first")

pd.DataFrame(rows).to_csv(settings.REPORTS_DIR / "c3-13_latency.csv", index=False)
print("Saved reports/c3-13_latency.csv  (LLM generation is measured separately in rag_eval.py)")