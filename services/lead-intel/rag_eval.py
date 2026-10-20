# services/lead-intel/rag_eval.py  — C3-13 RAG quality on 30 leads (10 hot, 10 warm, 10 cold)
# Measures: grounded rate, policy-consistency rate, citation method, sources per answer,
# LLM latency, and repeatability (3 leads asked twice -> same action?).
# Needs Ollama with Mistral + nomic and the KB.  Run:  python rag_eval.py   (about 15-45 min on CPU)
import json
import re
import time
import pandas as pd
import requests

from app import LEADS, score_lead
from rag import LLM_MODEL, RETRIEVAL, recommend

# base model keeps the original file names; a fine-tuned model gets its own files (C3-14 comparison)
TAG = "" if LLM_MODEL == "mistral:7b-instruct-q4_K_M" else "_" + re.sub(r"[^a-z0-9]+", "-", LLM_MODEL.lower())

TENANT, PER_SEGMENT = "tenant_a", 10
picked = {"hot": [], "warm": [], "cold": []}
for r in LEADS[LEADS.tenant == TENANT].sample(frac=1, random_state=42).to_dict("records"):
    lead = {**r, "lead_id": r["contact_id"]}
    s = score_lead(lead)
    if len(picked[s["segment"]]) < PER_SEGMENT:
        picked[s["segment"]].append((lead, s))
    if all(len(v) == PER_SEGMENT for v in picked.values()):
        break

rows, answers = [], {}
for seg, items in picked.items():
    for n, (lead, s) in enumerate(items, 1):
        print(f"{seg} {n}/{PER_SEGMENT}: {lead['lead_id']} ...", end=" ", flush=True)
        t0 = time.perf_counter()
        try:
            out = recommend(TENANT, lead, s)
        except requests.RequestException as e:              # one slow/failed call must not stop the run
            print(f"ERROR {type(e).__name__} - skipped")
            rows.append({"lead_id": lead["lead_id"], "segment": seg, "score": s["score"], "error": type(e).__name__})
            continue
        sec = time.perf_counter() - t0
        answers[lead["lead_id"]] = out.get("next_best_action")
        rows.append({"lead_id": lead["lead_id"], "segment": seg, "score": s["score"],
                     "grounded": out["grounded"], "policy_check": out["policy_check"],
                     "citation_method": out["citation_method"], "n_sources": len(out["sources"]),
                     "confidence": out["confidence"], "latency_sec": round(sec, 1)})
        print(f"grounded={out['grounded']} policy={out['policy_check']} {sec:.0f}s")

repeat = []
for lead, s in [picked[k][0] for k in picked]:                  # repeatability check
    if lead["lead_id"] not in answers:
        continue
    print(f"repeat {lead['lead_id']} ...", flush=True)
    again = recommend(TENANT, lead, s).get("next_best_action")
    repeat.append(again == answers[lead["lead_id"]])

df = pd.DataFrame(rows)
errors = int(df["error"].notna().sum()) if "error" in df else 0
df = df[df["error"].isna()] if "error" in df else df
pd.DataFrame(rows).to_csv(f"reports/c3-13_rag_eval{TAG}.csv", index=False)
summary = {
    "tenant": TENANT, "llm_model": LLM_MODEL, "leads": len(df), "errors_skipped": errors, "retrieval_method": RETRIEVAL,
    "grounded_rate": round(df.grounded.mean(), 3),
    "policy_consistent_rate_of_grounded": round((df[df.grounded].policy_check == "consistent").mean(), 3),
    "model_citation_rate": round((df.citation_method == "model_citation").mean(), 3),
    "avg_sources": round(df.n_sources.mean(), 2),
    "latency_sec_median": float(df.latency_sec.median()), "latency_sec_p95": float(df.latency_sec.quantile(.95)),
    "same_answer_on_repeat": f"{sum(repeat)} of {len(repeat)}",
    "by_segment": df.groupby("segment")[["grounded"]].mean().round(3)["grounded"].to_dict(),
}
json.dump(summary, open(f"reports/c3-13_rag_eval_summary{TAG}.json", "w"), indent=2)
print(json.dumps(summary, indent=2))