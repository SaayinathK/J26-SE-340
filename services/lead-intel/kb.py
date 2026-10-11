# services/lead-intel/kb.py  — C3-07 Tenant-scoped lead knowledge base
# Builds anonymised text documents per tenant, embeds them with nomic-embed-text
# (Ollama) and stores them per tenant. Storage: local files now (data/kb/<tenant>.*);
# the same documents move to the shared pgvector table when the C4 database is ready.
import json
import re
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import requests

from features import load

OLLAMA = "http://localhost:11434"          # or Jasinthan's shared host
EMBED_MODEL = "nomic-embed-text"
KB_DIR = Path("data/kb")
BC_DIR = Path("data/business_context")
TENANTS = ["tenant_a", "tenant_b", "tenant_c"]
PII = re.compile(r"[\w.+-]+@[\w-]+\.\w+|(?<![\d.])\+?\d[\d\s-]{8,}\d(?![\d.])")   # emails, phone numbers (not decimals)


# ---------------- embeddings ----------------
def embed(texts: list[str], batch: int = 32) -> np.ndarray:
    """nomic-embed-text -> 768 numbers per text, normalised for cosine similarity."""
    out = []
    for i in range(0, len(texts), batch):
        chunk = texts[i:i + batch]
        r = requests.post(f"{OLLAMA}/api/embed",
                          json={"model": EMBED_MODEL, "input": chunk}, timeout=300)
        r.raise_for_status()
        out.extend(r.json()["embeddings"])
        print(f"  embedded {min(i + batch, len(texts))}/{len(texts)}", end="\r")
    v = np.array(out, dtype=np.float32)
    return v / np.linalg.norm(v, axis=1, keepdims=True)


# ---------------- documents ----------------
def _s(v, default="unknown"):
    return default if v is None or (isinstance(v, float) and np.isnan(v)) else v


def lead_text(r, with_outcome: bool = True) -> str:
    """One short, anonymised document per lead (no name, email or phone)."""
    tags = r["tags"] if isinstance(r["tags"], list) and r["tags"] else ["none"]
    text = (f"Lead from source {_s(r['source'])} via {_s(r['lead_origin'])}. "
            f"Occupation: {_s(r['occupation'])}. Specialization: {_s(r['specialization'])}. "
            f"{int(_s(r['total_visits'], 0))} website visits, "
            f"{int(_s(r['time_on_site_sec'], 0))} seconds on site, "
            f"{round(float(_s(r['pages_per_visit'], 0)), 1)} pages per visit. "
            f"Last activity: {_s(r['last_activity'])}. Tags: {', '.join(map(str, tags))}.")
    if with_outcome:
        text += " Outcome: converted." if r["converted"] == 1 else " Outcome: did not convert."
    return text


def pattern_docs(df: pd.DataFrame) -> list[str]:
    """Patterns COMPUTED from this tenant's own leads (real numbers, not invented)."""
    docs = []
    base = df.converted.mean()
    for col, label in [("source", "lead source"), ("last_activity", "last activity"),
                       ("occupation", "occupation"), ("lead_origin", "lead origin")]:
        g = df.groupby(col).converted.agg(["size", "mean"])
        for value, row in g[g["size"] >= 30].iterrows():
            docs.append(f"Pattern: leads with {label} '{value}' converted at "
                        f"{row['mean']:.0%} (n={int(row['size'])}), "
                        f"compared with the tenant average of {base:.0%}.")
    long_visit = df.time_on_site_sec >= 600
    docs.append(f"Pattern: leads who spent 10+ minutes on the website converted at "
                f"{df[long_visit].converted.mean():.0%} (n={int(long_visit.sum())}); "
                f"others at {df[~long_visit].converted.mean():.0%}.")
    return docs


def business_docs(tenant: str) -> list[str]:
    path = BC_DIR / f"{tenant}.md"
    if not path.exists():
        print(f"  WARNING: {path} not found - no business context for {tenant}")
        return []
    paras = [p.strip() for p in path.read_text(encoding="utf-8").split("\n\n")]
    return [p for p in paras if p and not p.startswith("#")]


# ---------------- build + search ----------------
def build(tenant: str, df: pd.DataFrame) -> dict:
    t = df[df.tenant == tenant]
    rows = []
    for r in t.to_dict("records"):
        rows.append({"type": "lead_profile", "text": lead_text(r),
                     "contact_id": r["contact_id"], "converted": int(r["converted"])})
    rows += [{"type": "pattern", "text": x} for x in pattern_docs(t)]
    rows += [{"type": "business_context", "text": x} for x in business_docs(tenant)]
    for i, row in enumerate(rows):
        row["id"] = f"{tenant}:{i}"
        assert not PII.search(row["text"]), f"PII found, not indexed: {row['text'][:60]}"

    print(f"{tenant}: {len(rows)} documents - embedding...")
    vecs = embed([r["text"] for r in rows])
    KB_DIR.mkdir(parents=True, exist_ok=True)
    np.save(KB_DIR / f"{tenant}_vectors.npy", vecs)
    with open(KB_DIR / f"{tenant}_docs.jsonl", "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r) + "\n")
    counts = pd.Series([r["type"] for r in rows]).value_counts().to_dict()
    print(f"\n{tenant}: saved {counts}")
    return counts


_CACHE = {}


def _open(tenant: str):
    if tenant not in _CACHE:
        docs = [json.loads(l) for l in open(KB_DIR / f"{tenant}_docs.jsonl", encoding="utf-8")]
        _CACHE[tenant] = (docs, np.load(KB_DIR / f"{tenant}_vectors.npy"))
    return _CACHE[tenant]


def search(tenant: str, query: str, k: int = 5, types=None, exclude_contact=None) -> list[dict]:
    """Cosine-similarity search inside ONE tenant's knowledge base only."""
    docs, vecs = _open(tenant)
    q = embed([query])[0]
    sims = vecs @ q
    hits = []
    for i in np.argsort(-sims):
        d = docs[i]
        if types and d["type"] not in types:
            continue
        if exclude_contact and d.get("contact_id") == exclude_contact:
            continue
        hits.append({**d, "score": round(float(sims[i]), 3)})
        if len(hits) == k:
            break
    return hits


if __name__ == "__main__":
    df = load()
    tenants = sys.argv[1:] or TENANTS
    summary = {t: build(t, df) for t in tenants}
    pd.DataFrame(summary).T.fillna(0).astype(int).to_csv("reports/c3-07_kb_counts.csv")
    print("\nKB summary:", summary)
    print("\nTest search (tenant_a): 'working professional from Google who opened an email'")
    for h in search("tenant_a", "working professional from Google who opened an email", k=3):
        print(f"  [{h['score']}] {h['type']}: {h['text'][:110]}")