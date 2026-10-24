# services/lead-intel/src/agent/kb.py  — C3-07 Tenant-scoped lead knowledge base (+ C3-09 retrieval methods)
# Builds anonymised text documents per tenant, embeds them with nomic-embed-text
# (through clients/model_client.py) and stores them per tenant. Storage: files in
# ml/lead-intel/data/processed/kb/<tenant>_* (see C3-ADR-004). Build them with:
#   python ml/lead-intel/training/build_kb.py
import json
import re

import numpy as np
import pandas as pd

from clients.model_client import embed
from config import settings
from services.features import load  # noqa: F401  (kept: build_kb.py and tests use kb.load)

OLLAMA = settings.OLLAMA_URL
EMBED_MODEL = settings.EMBED_MODEL
KB_DIR = settings.KB_DIR
BC_DIR = settings.BC_DIR
TENANTS = ["tenant_a", "tenant_b", "tenant_c"]
PII = re.compile(r"[\w.+-]+@[\w-]+\.\w+|(?<![\d.])\+?\d[\d\s-]{8,}\d(?![\d.])")   # emails, phone numbers (not decimals)


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


def search(tenant: str, query: str, k: int = 5, types=None, exclude_contact=None,
           method: str = "embedding") -> list[dict]:
    """Search inside ONE tenant's knowledge base only (method: see RETRIEVAL_METHODS)."""
    docs, _ = _open(tenant)
    sims = scores(tenant, query, method)
    hits = []
    for i in np.argsort(-sims, kind="stable"):
        d = docs[i]
        if types and d["type"] not in types:
            continue
        if exclude_contact and d.get("contact_id") == exclude_contact:
            continue
        hits.append({**d, "score": round(float(sims[i]), 3)})
        if len(hits) == k:
            break
    return hits


# ---------------- C3-09: keyword (BM25), embedding, hybrid and RRF scoring ----------------
RETRIEVAL_METHODS = ["bm25", "embedding", "hybrid", "rrf"]
HYBRID_ALPHA = 0.7          # weight of the embedding score in the hybrid; 0.7 was best in C3-09 (MRR, P@5)
RRF_K = 60                  # standard constant for reciprocal rank fusion
_BM25 = {}


def tokens(text: str) -> list[str]:
    return re.findall(r"[a-z0-9]+", str(text).lower())


def _bm25(tenant: str):
    if tenant not in _BM25:
        from rank_bm25 import BM25Okapi
        docs, _ = _open(tenant)
        _BM25[tenant] = BM25Okapi([tokens(d["text"]) for d in docs])
    return _BM25[tenant]


def _minmax(x: np.ndarray) -> np.ndarray:
    lo, hi = float(x.min()), float(x.max())
    return np.zeros_like(x) if hi == lo else (x - lo) / (hi - lo)


def _ranks(x: np.ndarray) -> np.ndarray:
    r = np.empty(len(x))
    r[np.argsort(-x, kind="stable")] = np.arange(1, len(x) + 1)
    return r


def scores(tenant: str, query: str, method: str = "embedding", q_vec=None,
           alpha: float = HYBRID_ALPHA) -> np.ndarray:
    """One relevance score per document of this tenant (higher = more relevant).
    q_vec can be passed in so the query is embedded only once."""
    if method not in RETRIEVAL_METHODS:
        raise ValueError(f"unknown retrieval method {method!r}; use one of {RETRIEVAL_METHODS}")
    docs, vecs = _open(tenant)
    kw = _bm25(tenant).get_scores(tokens(query)) if method != "embedding" else None
    if method == "bm25":
        return np.asarray(kw, dtype=float)
    if q_vec is None:
        q_vec = embed([query])[0]
    emb = vecs @ q_vec
    if method == "embedding":
        return emb
    if method == "hybrid":
        return alpha * _minmax(emb) + (1 - alpha) * _minmax(np.asarray(kw, dtype=float))
    return 1 / (RRF_K + _ranks(emb)) + 1 / (RRF_K + _ranks(np.asarray(kw, dtype=float)))   # rrf


# ---------------- KB size report ----------------
COUNTS_CSV = settings.REPORTS_DIR / "c3-07_kb_counts.csv"


def counts_from_files() -> pd.DataFrame:
    """Re-count documents from the saved KB files (no embedding needed)."""
    rows = {}
    for t in TENANTS:
        f = KB_DIR / f"{t}_docs.jsonl"
        if f.exists():
            types = [json.loads(l)["type"] for l in open(f, encoding="utf-8")]
            rows[t] = pd.Series(types).value_counts().to_dict()
    return pd.DataFrame(rows).T.fillna(0).astype(int)[["lead_profile", "pattern", "business_context"]]
