# services/lead-intel/baseline.py  — C3-03
# GHL-style rule-based point scoring = the "current CRM practice" baseline.
import numpy as np
import pandas as pd
from sklearn.metrics import roc_auc_score
from features import load, split

# Point rules written from common CRM practice BEFORE looking at
# conversion rates per category, so the baseline is not tuned on the data.
RULES = [
    ("Submitted a lead form (Lead Add Form)", 20),
    ("2 points per website visit (max 20)", 20),
    ("5+ minutes on the website", 15),
    ("Last activity = Email Opened or SMS Sent", 10),
    ("Occupation field completed", 10),
    ("Opted out of email (Do Not Email)", -10),
]

def rule_score(r) -> int:
    s = 0
    if r.lead_origin == "Lead Add Form":
        s += 20
    visits = 0 if pd.isna(r.total_visits) else int(r.total_visits)
    s += min(visits * 2, 20)
    if r.time_on_site_sec >= 300:
        s += 15
    if r.last_activity in ("Email Opened", "SMS Sent"):
        s += 10
    if isinstance(r.occupation, str):
        s += 10
    if r.dnd_email:
        s -= 10
    return int(np.clip(s, 0, 100))

if __name__ == "__main__":
    _, _, test = split(load())
    scores = test.apply(rule_score, axis=1)
    auc = roc_auc_score(test.converted, scores)
    print("Rule table:")
    for name, pts in RULES:
        print(f"  {pts:+4d}  {name}")
    print(f"\nTest leads: {len(test)}")
    print(f"Rule-based baseline AUC (test set): {auc:.3f}")
    pd.DataFrame([{"method": "rule-based (GHL-style)", "auc_test": round(auc, 3)}]) \
      .to_csv("reports/c3-03_baseline.csv", index=False)
    print("Saved reports/c3-03_baseline.csv")