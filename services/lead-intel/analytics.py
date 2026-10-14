# services/lead-intel/analytics.py  — C3-10 Behavioural analytics
import re
import pandas as pd

# Stages are DERIVED from activity (the dataset has no pipeline-stage field)
CONTACTED = {"SMS Sent", "Had a Phone Conversation", "Olark Chat Conversation",
             "Email Opened", "Email Link Clicked"}
STAGES = {1: "Captured", 2: "Engaged (visited site)", 3: "Contacted", 4: "Won"}

# From the EDA (Tags): reasons a lead did not buy vs. problems reaching the lead
OBJECTIONS = {"interested in other courses", "already a student", "not doing further education",
              "interested in full time mba", "graduation in progress", "diploma holder (not eligible)",
              "want to take admission but has financial problems", "still thinking",
              "in confusion whether part time or dlp", "lost to eins", "lost to others",
              "university not recognized", "recognition issue (dec approval)"}
CONTACT_PROBLEMS = {"ringing", "switched off", "invalid number", "wrong number given",
                    "number not provided", "opp hangup", "busy"}

def _norm(t):
    return re.sub(r"\s+", " ", str(t)).strip().lower()

def stage(r) -> int:
    if r.converted == 1:
        return 4
    if r.last_activity in CONTACTED:
        return 3
    if pd.notna(r.total_visits) and r.total_visits > 0:
        return 2
    return 1

def insights(df: pd.DataFrame) -> dict:
    by_src = df.groupby("source").converted.agg(leads="size", conversion_rate="mean")
    by_src = by_src[by_src.leads >= 30].sort_values("conversion_rate", ascending=False)

    st = df.apply(stage, axis=1)
    reached = {s: int((st >= s).sum()) for s in STAGES}
    drops = {f"{STAGES[s]} -> {STAGES[s + 1]}": round(1 - reached[s + 1] / reached[s], 3)
             for s in (1, 2, 3)}

    lost = df.loc[df.converted == 0, "tag"].dropna().map(_norm)
    objections = lost[lost.isin(OBJECTIONS)].value_counts().head(5)
    contact = lost[lost.isin(CONTACT_PROBLEMS)].value_counts().head(5)

    return {
        "tenant_leads": int(len(df)),
        "conversion_rate": round(float(df.converted.mean()), 3),
        "top_sources": by_src.head(3).round(3).reset_index().to_dict("records"),
        "funnel": {STAGES[s]: n for s, n in reached.items()},
        "drop_off_rates": drops,
        "biggest_drop_off": max(drops, key=drops.get),
        "common_objections": {k: int(v) for k, v in objections.items()},
        "contact_problems": {k: int(v) for k, v in contact.items()},
        "note": "Stages derived from last activity; objections derived from sales tags.",
    }

if __name__ == "__main__":
    import json
    from features import load
    df = load()
    for t in ["tenant_a", "tenant_b", "tenant_c"]:
        print(f"\n===== {t} =====")
        print(json.dumps(insights(df[df.tenant == t]), indent=2))