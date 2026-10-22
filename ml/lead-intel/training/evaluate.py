# ml/lead-intel/training/evaluate.py  (was accuracy_check.py)  — Are the dashboard numbers right, and how accurate is the score?
# Part A: recompute every dashboard number straight from the CRM file (plain pandas) and compare with the API.
# Part B: model accuracy on the TEST split only (leads the model never saw in training).
# Run:  python ml/lead-intel/training/evaluate.py [tenant_a]     (no Ollama needed, about 30 s)
# Output: printed tables + ml/lead-intel/reports/c3-accuracy_check.json
import json
import os
import sys
import tempfile

os.environ["C3_STATE_DIR"] = tempfile.mkdtemp()   # do not touch the real lead history
os.environ["C3_DATABASE_URL"] = ""

import joblib                                            # noqa: E402
import numpy as np                                       # noqa: E402
import pandas as pd                                      # noqa: E402
from fastapi.testclient import TestClient                # noqa: E402
from sklearn.metrics import brier_score_loss, confusion_matrix, roc_auc_score  # noqa: E402

import _paths  # noqa: F401,E402
from config import settings                              # noqa: E402
from main import app                                     # noqa: E402
from services.features import CATEGORICAL, NUMERIC, add_features, split   # noqa: E402

TENANT = sys.argv[1] if len(sys.argv) > 1 else "tenant_a"
client = TestClient(app)
H = {"X-Tenant-Id": TENANT}
rows, ok_all = [], True


def check(name, ours, api, tol=0.001):
    global ok_all
    same = (abs(float(ours) - float(api)) <= tol) if isinstance(ours, (int, float, np.number)) else ours == api
    ok_all &= bool(same)
    rows.append({"check": name, "recomputed": ours, "api": api, "result": "PASS" if same else "FAIL"})


# ---------------- Part A: dashboard numbers ----------------
raw = pd.read_json(settings.LEADS_PATH, lines=True)
t = raw[raw.tenant == TENANT].copy()
model = joblib.load(settings.MODEL_PATH)["calibrated"]
t["score"] = (model.predict_proba(add_features(t)[NUMERIC + CATEGORICAL])[:, 1] * 100).round().astype(int)
t["segment"] = np.where(t.score >= 70, "hot", np.where(t.score >= 40, "warm", "cold"))

dash = client.get("/leads/dashboard", headers=H).json()
ana = client.get("/leads/analytics", headers=H).json()
api_seg = {s["segment"]: s for s in dash["segments"]}

check("All leads", len(t), dash["tenant_leads"], 0)
check("Became customers (rate)", round(t.converted.mean(), 3), ana["conversion_rate"])
for s in ("hot", "warm", "cold"):
    part = t[t.segment == s]
    check(f"{s} leads (count)", len(part), api_seg[s]["leads"], 0)
    check(f"{s} leads bought (rate)", round(part.converted.mean(), 3), api_seg[s]["conversion_rate"])
by_src = t.groupby("source").converted.agg(["size", "mean"])
by_src = by_src[by_src["size"] >= 30].sort_values("mean", ascending=False).head(3)
for (src, r), a in zip(by_src.iterrows(), ana["top_sources"]):
    check(f"Best source {src}", round(r["mean"], 3), round(a["conversion_rate"], 3))
top = t.sort_values(["score", "contact_id"], ascending=[False, True]).head(10)
api_top = [x["lead_id"] for x in dash["top_10_hottest"]]
same_top = sum(a == b for a, b in zip(top.contact_id, api_top))
check("Top-10 hottest leads (same IDs, same order)", f"{same_top} of 10", "10 of 10")

print(f"\nPart A - dashboard numbers for {TENANT} (recomputed from the CRM file vs. the API)")
print(pd.DataFrame(rows).to_string(index=False))

# ---------------- Part B: model accuracy on unseen leads ----------------
leads = add_features(raw)
_, _, test = split(leads)                                # same 70/15/15 split as training: test = never seen
test = test.copy()
test["p"] = model.predict_proba(test[NUMERIC + CATEGORICAL])[:, 1]
test["score"] = (test.p * 100).round().astype(int)
test["segment"] = np.where(test.score >= 70, "hot", np.where(test.score >= 40, "warm", "cold"))


def metrics(d: pd.DataFrame) -> dict:
    y, p = d.converted.values, d.p.values
    pred = (p >= 0.5).astype(int)
    tn, fp, fn, tp = confusion_matrix(y, pred, labels=[0, 1]).ravel()
    hot = d.segment == "hot"
    return {
        "leads": int(len(d)),
        "auc": round(float(roc_auc_score(y, p)), 3),
        "accuracy_at_50": round(float((pred == y).mean()), 3),
        "precision_at_50": round(float(tp / max(1, tp + fp)), 3),
        "recall_at_50": round(float(tp / max(1, tp + fn)), 3),
        "confusion_at_50": {"bought_and_predicted": int(tp), "bought_but_missed": int(fn),
                            "not_bought_but_predicted": int(fp), "not_bought_and_not_predicted": int(tn)},
        "brier": round(float(brier_score_loss(y, p)), 4),
        "hot_leads_that_bought": round(float(d[hot].converted.mean()), 3) if hot.any() else None,
        "calibration": {s: {"leads": int((d.segment == s).sum()),
                            "average_score": round(float(d[d.segment == s].score.mean()), 1),
                            "really_bought": round(float(d[d.segment == s].converted.mean()), 3)}
                        for s in ("hot", "warm", "cold") if (d.segment == s).any()},
    }


result = {"tenant": TENANT, "part_a_all_pass": bool(ok_all), "part_a": rows,
          "part_b_test_all_tenants": metrics(test),
          f"part_b_test_{TENANT}": metrics(test[test.tenant == TENANT]),
          "note": "Part B uses only test-split leads (never used for training). Dashboard rates use ALL "
                  "historical leads, including training leads, so they are slightly optimistic."}

print(f"\nPart B - model accuracy on {len(test)} unseen test leads (all tenants)")
for k, v in result["part_b_test_all_tenants"].items():
    print(f"  {k:24} {v}")
print(f"\nPart A all PASS: {ok_all}")
json.dump(result, open(settings.REPORTS_DIR / "c3-accuracy_check.json", "w"), indent=2, default=str)
print("Saved ml/lead-intel/reports/c3-accuracy_check.json")
