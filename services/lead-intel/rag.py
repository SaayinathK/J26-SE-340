# services/lead-intel/rag.py  — C3-08 RAG recommendation (KF2)
# lead -> retrieve similar past leads + computed patterns + business context
#      (this tenant only) -> Mistral 7B writes a grounded next-best-action.
import json
import os
import re
import time

import numpy as np
import requests

from kb import OLLAMA, embed, lead_text, _open

LLM_MODEL = os.getenv("C3_LLM_MODEL", "mistral:7b-instruct-q4_K_M")
K = {"lead_profile": 3, "pattern": 3, "business_context": 4}
ATTRIBUTION_MIN_SIM = 0.60     # answer must be this similar to a source to count as supported


def query_text(lead: dict) -> str:
    """The lead as the system sees it BEFORE the outcome: no outcome, no sales tags."""
    return lead_text({**lead, "tags": []}, with_outcome=False)


def retrieve(tenant: str, lead: dict) -> list[dict]:
    """One embedding of the lead (outcome hidden), then top-k per document type."""
    docs, vecs = _open(tenant)
    q = embed([query_text(lead)])[0]
    sims = vecs @ q
    hits, need = [], dict(K)
    for i in np.argsort(-sims):
        d = docs[i]
        if need.get(d["type"], 0) == 0:
            continue
        if d.get("contact_id") == lead["lead_id"]:      # never retrieve the lead itself
            continue
        hits.append({**d, "score": round(float(sims[i]), 3), "vec": vecs[i]})
        need[d["type"]] -= 1
        if not any(need.values()):
            break
    if not any("follow-up policy" in h["text"].lower() for h in hits):   # policy must always be in context
        for i, d in enumerate(docs):
            if d["type"] == "business_context" and "follow-up policy" in d["text"].lower():
                hits.append({**d, "score": round(float(sims[i]), 3), "vec": vecs[i]})
                break
    for n, h in enumerate(hits, 1):                      # short labels the LLM can copy: S1, S2 ...
        h["label"] = f"S{n}"
    return hits


PROMPT = """You are the Lead Intelligence assistant for a marketing agency.
Use ONLY the numbered SOURCES below. Do not invent offers, prices, numbers or names.

LEAD: {lead}
LEAD SCORE: {score}/100 ({segment}). Main factors: {factors}

SOURCES:
{context}

REQUIRED: this is a {segment} lead. The business policy says {segment} leads {rule} (source {rule_label}).
The next_best_action MUST follow this policy.
Answer with ONLY this JSON object, "sources" FIRST:
{{"sources": ["S1", "S4"],
  "next_best_action": "<one sentence: what the sales team should do next and when>",
  "message_draft": "<short personalised message to this lead, max 60 words>"}}
"sources" must list the labels (S1, S2, ...) of the SOURCES you used. It must not be empty."""


STOP = {"the", "a", "an", "get", "gets", "go", "into", "with", "and", "to", "of", "in", "on", "same", "day", "lead", "leads"}


def segment_policy(segment: str, hits: list[dict]):
    """Find this tenant's rule for the segment, e.g. 'cold leads go into a monthly newsletter'."""
    for h in hits:
        if "follow-up policy" in h["text"].lower():
            m = re.search(rf"{segment} leads ([^;.]+)", h["text"], re.I)
            if m:
                return m.group(1).strip(), h["label"]
    return None, None


def policy_check(action: str, rule: str) -> str:
    """Does the action follow the rule? Simple keyword overlap - reported, not hidden."""
    if not rule or not action:
        return "no_policy_found"
    words = {w for w in re.findall(r"[a-z]+", rule.lower()) if w not in STOP and len(w) > 3}
    return "consistent" if any(w in action.lower() for w in words) else "inconsistent"


def _generate(prompt: str) -> dict:
    r = requests.post(f"{OLLAMA}/api/generate", timeout=300, json={
        "model": LLM_MODEL, "prompt": prompt, "stream": False, "format": "json",
        "keep_alive": "30m",
        "options": {"temperature": 0.2, "seed": 42, "num_predict": 220}})
    r.raise_for_status()
    text = r.json()["response"]
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return {"unparsed_text": text}


def _labels(raw) -> list[str]:
    """Accept 'S1', '[S1]', 's1', 1, {'id': 'S1'} ... -> 'S1'."""
    if not isinstance(raw, list):
        raw = [raw]
    out = []
    for x in raw:
        if isinstance(x, dict):
            x = x.get("id") or x.get("label") or ""
        if isinstance(x, int):
            out.append(f"S{x}")
            continue
        m = re.fullmatch(r"\s*\[?\s*[Ss]\s*(\d+)\s*\]?\s*", str(x))
        if m:
            out.append(f"S{int(m.group(1))}")
    return list(dict.fromkeys(out))                      # unique, keep order


def _norm_keys(out) -> dict:
    """Mistral sometimes returns 'Sources', 'next best action', or wraps the answer: normalise."""
    if not isinstance(out, dict):
        return {}
    if len(out) == 1 and isinstance(next(iter(out.values())), dict):   # {"answer": {...}}
        out = next(iter(out.values()))
    return {re.sub(r"[^a-z]", "", str(k).lower()): v for k, v in out.items()}


def ground(out: dict, hits: list[dict]) -> dict:
    """Keep only sources that were really retrieved; block ungrounded answers (risk R08)."""
    known = {h["label"]: h for h in hits}
    o = _norm_keys(out)
    action = o.get("nextbestaction") or o.get("action")
    message = o.get("messagedraft") or o.get("message")
    raw_sources = o.get("sources") or o.get("source") or o.get("sourcesused") or []
    cited = [s for s in _labels(raw_sources) if s in known]
    if not cited:                       # labels written inside the answer text, e.g. "(S10)"
        inline = re.findall(r"\bS\d+\b", f"{action} {message}")
        cited = [s for s in dict.fromkeys(inline) if s in known]
    if not cited or not action:
        return {"next_best_action": None, "message_draft": None, "sources": [],
                "confidence": 0.0, "grounded": False,
                "flag": "UNGROUNDED: the model cited no retrieved source - answer blocked",
                "model_raw": out}
    return {"next_best_action": action,
            "message_draft": message,
            "sources": [{"id": known[s]["id"], "label": s, "type": known[s]["type"],
                         "text": known[s]["text"]} for s in cited],
            "confidence": round(sum(known[s]["score"] for s in cited) / len(cited), 2),
            "grounded": True}


def attribute(out: dict, hits: list[dict]) -> dict:
    """Fallback when the model lists no sources: find which retrieved sources the
    answer actually matches (post-hoc attribution by embedding similarity)."""
    o = _norm_keys(out)
    answer = f"{o.get('nextbestaction') or ''} {o.get('messagedraft') or ''}".strip()
    if not answer:
        return out
    a = embed([answer])[0]
    sims = sorted(((float(h["vec"] @ a), h["label"]) for h in hits), reverse=True)
    supported = [label for sim, label in sims if sim >= ATTRIBUTION_MIN_SIM][:3]
    return {**o, "next_best_action": o.get("nextbestaction"), "message_draft": o.get("messagedraft"),
            "sources": supported, "_attribution": [(lb, round(sm, 3)) for sm, lb in sims[:3]]}


def recommend(tenant: str, lead: dict, scored: dict) -> dict:
    t0 = time.perf_counter()
    hits = retrieve(tenant, lead)
    similar = [h for h in hits if h["type"] == "lead_profile"]
    similar_rate = (f"{sum(h['converted'] for h in similar)} of {len(similar)}" if similar else "n/a")
    rule, rule_label = segment_policy(scored["segment"], hits)
    prompt = PROMPT.format(
        rule=rule or "(no policy found - use the sources)", rule_label=rule_label or "-",
        lead=query_text(lead),
        score=scored["score"], segment=scored["segment"],
        factors=", ".join(f["feature"] for f in scored["top_factors"]),
        context="\n".join(f"{h['label']}: ({h['type']}) {h['text']}" for h in hits))
    raw = _generate(prompt)
    method = "model_citation"
    out = ground(raw, hits)
    if not out["grounded"]:                       # model gave an answer but no usable labels
        attributed = attribute(raw, hits)
        out = ground(attributed, hits)
        method = "post_hoc_attribution" if out["grounded"] else "none"
        out["attribution_top3"] = attributed.get("_attribution") if isinstance(attributed, dict) else None
        if not out["grounded"]:
            out["model_raw"] = raw
    out["policy_rule"] = rule
    out["policy_check"] = policy_check(out.get("next_best_action") or "", rule)
    out.update({"citation_method": method, "lead_id": lead["lead_id"], "score": scored["score"],
                "segment": scored["segment"], "similar_leads_converted": similar_rate,
                "latency_sec": round(time.perf_counter() - t0, 1)})
    return out