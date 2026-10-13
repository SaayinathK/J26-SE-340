# services/lead-intel/retrieval_eval.py  — C3-09 Retrieval optimisation
# Compares 4 ways of ranking a tenant's knowledge base on 50 labelled queries:
#   bm25 (keyword) | embedding (nomic, current C3-08) | hybrid (0.5 BM25 + 0.5 embedding) | rrf
# plus the hybrid weight at 0.3 and 0.7. Metrics: P@5, Hit@5, MRR, median latency.
#
# Relevance labels are made by rules from the data (silver labels), not by hand:
#   lead_similarity (~30): a past lead is relevant if it has the same source, lead origin,
#                         occupation and last activity as the query lead
#   pattern (12):         the pattern document about the asked value
#   business_context (8): the business paragraph that answers the question
# Each query is searched only among documents of its own type, as rag.retrieve() does.
#
# Run (Ollama running, KB built with kb.py):   python retrieval_eval.py [tenant_a]
import json
import re
import sys
import time

import numpy as np
import pandas as pd

import kb
from rag import query_text

K = 5
SEED = 42
N_TOTAL, N_PATTERN = 50, 12     # 30 lead + 12 pattern + 8 business when available
MATCH_ON = ["source", "lead_origin", "occupation", "last_activity"]
BUSINESS_QUESTIONS = [                                  # (question, paragraph that answers it)
    ("What is the follow-up policy for a hot lead?", "Follow-up policy"),
    ("How should we follow up with cold leads?", "Follow-up policy"),
    ("What should the next step be for a warm lead?", "Follow-up policy"),
    ("What does the business sell to its customers?", "Offer"),
    ("Who is the ideal customer for this programme?", "Ideal customer"),
    ("What payment options or discounts can we offer?", "Pricing"),
    ("A lead is worried about the cost. What can we offer?", "Pricing"),
    ("How do we answer a lead who raises an objection?", "Objection"),
]
METHODS = {"bm25": ("bm25", None), "embedding": ("embedding", None),
           "hybrid_0.3": ("hybrid", 0.3), "hybrid_0.5": ("hybrid", 0.5), "hybrid_0.7": ("hybrid", 0.7),
           "rrf": ("rrf", None)}


# ---------------- metrics ----------------
def precision_at_k(ranked: list, relevant: set, k: int = K) -> float:
    return sum(d in relevant for d in ranked[:k]) / k


def hit_at_k(ranked: list, relevant: set, k: int = K) -> float:
    return float(any(d in relevant for d in ranked[:k]))


def reciprocal_rank(ranked: list, relevant: set) -> float:
    for i, d in enumerate(ranked, 1):
        if d in relevant:
            return 1 / i
    return 0.0


# ---------------- labelled queries ----------------
def _key(r) -> tuple:
    return tuple("unknown" if pd.isna(r[c]) else r[c] for c in MATCH_ON)


def make_queries(tenant: str) -> list[dict]:
    docs, _ = kb._open(tenant)
    rng = np.random.default_rng(SEED)
    leads = kb.load()
    leads = leads[leads.tenant == tenant].set_index("contact_id")
    in_kb = [d for d in docs if d["type"] == "lead_profile" and d["contact_id"] in leads.index]
    groups: dict = {}
    for d in in_kb:
        groups.setdefault(_key(leads.loc[d["contact_id"]]), []).append(d)

    pats = [d for d in docs if d["type"] == "pattern" and "'" in d["text"]]
    biz = [d for d in docs if d["type"] == "business_context"]
    biz_q = [(q, [d["id"] for d in biz if d["text"].startswith(start)]) for q, start in BUSINESS_QUESTIONS]
    biz_q = [(q, rel) for q, rel in biz_q if rel]
    n_pattern = min(N_PATTERN, len(pats))
    n_lead = N_TOTAL - n_pattern - len(biz_q)                 # always 50 queries in total

    queries = []
    for i in rng.permutation(len(in_kb)):                      # 1) similar past leads
        d = in_kb[i]
        lead = leads.loc[d["contact_id"]]
        rel = {x["id"] for x in groups[_key(lead)] if x["id"] != d["id"]}
        if rel:
            queries.append({"type": "lead_similarity", "doc_type": "lead_profile",
                            "query": query_text(lead.to_dict()), "relevant": sorted(rel),
                            "exclude": d["id"]})
        if len(queries) == n_lead:
            break
    for i in rng.permutation(len(pats))[:n_pattern]:           # 2) computed patterns
        m = re.search(r"leads with (.+?) '(.+?)'", pats[i]["text"])
        queries.append({"type": "pattern", "doc_type": "pattern",
                        "query": f"How well do leads with {m.group(1)} {m.group(2)} convert?",
                        "relevant": [pats[i]["id"]]})
    for q, rel in biz_q:                                       # 3) business context
        queries.append({"type": "business_context", "doc_type": "business_context",
                        "query": q, "relevant": rel})
    return queries


# ---------------- evaluation ----------------
def evaluate(tenant: str):
    docs, _ = kb._open(tenant)
    ids = np.array([d["id"] for d in docs])
    types = np.array([d["type"] for d in docs])
    queries = make_queries(tenant)
    print(f"{tenant}: {len(queries)} queries over {len(docs)} documents")
    kb._bm25(tenant)                                            # build the keyword index once
    rows, log = [], []
    for n, q in enumerate(queries, 1):
        t0 = time.perf_counter()
        q_vec = kb.embed([q["query"]])[0]                       # one embedding call per query
        embed_ms = (time.perf_counter() - t0) * 1000
        mask = types == q["doc_type"]
        if q.get("exclude"):
            mask &= ids != q["exclude"]
        rel = set(q["relevant"])
        entry = {**{k: q[k] for k in ("type", "query")}, "n_relevant": len(rel), "top5": {}}
        for name, (method, alpha) in METHODS.items():
            t1 = time.perf_counter()
            s = kb.scores(tenant, q["query"], method, q_vec=q_vec, alpha=alpha or kb.HYBRID_ALPHA)
            ranked = list(ids[mask][np.argsort(-s[mask], kind="stable")])
            ms = (time.perf_counter() - t1) * 1000 + (0 if method == "bm25" else embed_ms)
            rows.append({"tenant": tenant, "query_type": q["type"], "method": name,
                         "p_at_5": precision_at_k(ranked, rel), "hit_at_5": hit_at_k(ranked, rel),
                         "rr": reciprocal_rank(ranked, rel), "latency_ms": ms})
            entry["top5"][name] = ranked[:K]
        log.append(entry)
        print(f"  query {n}/{len(queries)}", end="\r")
    return pd.DataFrame(rows), log


def summarise(df: pd.DataFrame) -> pd.DataFrame:
    agg = dict(queries=("rr", "size"), p_at_5=("p_at_5", "mean"), hit_at_5=("hit_at_5", "mean"),
               mrr=("rr", "mean"), median_latency_ms=("latency_ms", "median"))
    overall = df.groupby("method").agg(**agg).assign(query_type="ALL")
    by_type = df.groupby(["query_type", "method"]).agg(**agg).reset_index("query_type")
    return pd.concat([overall, by_type]).reset_index()[
        ["query_type", "method", "queries", "p_at_5", "hit_at_5", "mrr", "median_latency_ms"]].round(3)


if __name__ == "__main__":
    tenant = sys.argv[1] if len(sys.argv) > 1 else "tenant_a"
    raw, log = evaluate(tenant)
    table = summarise(raw)
    table.to_csv("reports/c3-09_retrieval_comparison.csv", index=False)
    with open("reports/c3-09_queries.json", "w", encoding="utf-8") as f:
        json.dump(log, f, indent=1)
    print("\n", table.to_string(index=False))

    overall = table[table.query_type == "ALL"].set_index("method")
    fast = overall[overall.median_latency_ms <= 500]            # NFR: retrieval within 0.5 s
    best = (fast if len(fast) else overall).sort_values(["mrr", "p_at_5"], ascending=False).index[0]
    print(f"\nBest by MRR within 500 ms: {best}")
    base = best.split("_")[0]
    print(f"To use it in RAG: set C3_RETRIEVAL={base}"
          + (f" and kb.HYBRID_ALPHA={best.split('_')[1]}" if base == "hybrid" else ""))
    print("Saved reports/c3-09_retrieval_comparison.csv and reports/c3-09_queries.json")