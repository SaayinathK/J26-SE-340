"""Privacy evaluation: (1) PII-leakage scan, (2) k-anonymity audit, (3) re-identification attacks.

Attack A (public-attribute linkage): the attacker knows every tenant's public attributes (industry, region, budget band, objective)
    and, for each published insight, guesses a tenant among those that match. Success = the guess really contributed to it.
Attack B (aggregate membership inference, worst case): the attacker even knows a target tenant's own channel mixes and asks whether the
    published aggregate "contains" it, scoring by distance. AUC 0.5 = no leak, 1.0 = perfect leak.
Both are reported next to what pure guessing would achieve, so the numbers can be read as lift over chance.
"""
from __future__ import annotations

import json
import re
import sqlite3
from collections import defaultdict

import numpy as np
from sklearn.metrics import roc_auc_score

from ..channels import CHANNEL_VOCAB
from ..db.shared_store import SharedStore
from ..privacy import k_anonymity as kanon
from ..privacy.anonymizer import Anonymizer
from .population import Population

STRUCTURED = {"EMAIL_ADDRESS", "PHONE_NUMBER", "URL", "IP_ADDRESS", "CREDIT_CARD", "IBAN_CODE", "US_SSN"}


def appears(needle: str, text: str) -> bool:
    """Does `needle` occur as a whole word / whole number? Numbers must stand alone: not the decimals of another number
    (0.2673 does not contain the budget 2673) and not part of a longer alphanumeric token."""
    text = text.lower()
    if re.fullmatch(r"[+\d\s().-]+", needle):
        if re.fullmatch(r"\d+(?:\.0+)?", needle.strip()):                       # a plain number such as a budget
            n = re.escape(needle.strip().split(".")[0])
            return re.search(r"(?<![0-9a-z.])" + n + r"(?:\.0+)?(?![0-9a-z.]*\d)", text) is not None
        digits = re.sub(r"\D", "", needle)                                      # a phone number: digits with optional single separators
        pattern = r"(?<![0-9])(?:\+|0{1,2})?" + r"[\s().-]?".join(re.escape(d) for d in digits) + r"(?![0-9])"   # +94 / 0094 / 94
        return re.search(pattern, text) is not None
    return re.search(r"(?<![a-z0-9])" + re.escape(needle.lower()) + r"(?![a-z0-9])", text) is not None


_appears = appears


def pii_leakage_scan(shared: SharedStore, pop: Population, anonymizer: Anonymizer) -> dict:
    text = shared.dump_all_text()
    leaked: dict[str, list[str]] = {}
    for tid, ids in pop.identifiers.items():
        needles = [("tenant_id", ids["tenant_id"]), ("email", ids["email"]), ("url", ids["url"].split("/")[2]), ("phone", ids["phone"]), ("budget", ids["budget"])]
        for kind in ("business", "brand", "product", "competitor", "person"):
            needles += [(kind, w) for w in ids[kind].split() if len(w) >= 4]
        hits = [k for k, n in needles if _appears(n, text)]
        if hits:
            leaked[tid] = sorted(set(hits))
    strings = []
    with sqlite3.connect(shared.path) as conn:
        for table, cols in (("contributions", "industry_bucket, region, budget_band, objective, channel_mix_json, angle, duration_bucket, period"),
                            ("insights", "industry_bucket, region, budget_band, objective, channel_mix_json, angle, summary")):
            for row in conn.execute(f"SELECT {cols} FROM {table}"):
                for v in row:
                    if v is None:
                        continue
                    if isinstance(v, str) and v.startswith("{"):                       # channel_mix_json: scan the channel NAMES only
                        strings.extend(str(k).replace("_", " ") for k in json.loads(v))
                    else:
                        strings.append(str(v).replace("_", " "))
    structured = sum(1 for s in strings if set(anonymizer.entities_in(s, [])) & STRUCTURED)
    return {"tenants_checked": len(pop.identifiers), "tenants_with_any_leak": len(leaked), "leakage_rate": round(len(leaked) / len(pop.identifiers), 4),
            "structured_pii_findings": structured, "strings_scanned": len(strings), "leaks_by_tenant": leaked,
            "opaque_ids_are_random_hex": shared.opaque_ids_are_random_hex(), "detector": anonymizer.engine}


def k_anonymity_audit(shared: SharedStore, k: int) -> dict:
    contribs = shared.list_contributions()
    groups = kanon.group_by_qi(contribs)
    insights = shared.query_insights(limit=10_000)
    key_of = lambda i: (i["industry_bucket"], i["region"], i["budget_band"], i["objective"])  # noqa: E731
    supports = [kanon.distinct_contributors(groups.get(key_of(i), [])) for i in insights]
    below = {key: g for key, g in groups.items() if kanon.distinct_contributors(g) < k}
    published_keys = {key_of(i) for i in insights}
    return {"k": k, "insights_published": len(insights), "min_distinct_contributors_in_published": min(supports) if supports else None,
            "all_published_groups_have_at_least_k": all(s >= k for s in supports), "groups_total": len(groups), "groups_below_k": len(below),
            "below_k_groups_published": len(set(below) & published_keys), "contributions_held_back": sum(len(g) for g in below.values())}


def qi_reidentification(shared: SharedStore, pop: Population) -> dict:
    """Attack A, PARTICIPATION DISCLOSURE: the attacker knows every tenant's public attributes (industry, region, budget band, objective)
    and a published insight. For a target matching the insight's attributes, P(target contributed) = contributors / candidates.
    k-anonymity guarantees an insight is backed by >= k tenants; it does NOT hide who participated when (almost) every matching tenant did."""
    contributors, candidates = pop.contributors_by_qi(), pop.candidates_by_qi()
    rows = []
    for i in shared.query_insights(limit=10_000):
        key = (i["industry_bucket"], i["region"], i["budget_band"], i["objective"])
        cand, contrib = candidates.get(key, set()), contributors.get(key, set())
        if cand:
            rows.append({"p": len(contrib & cand) / len(cand), "candidates": len(cand), "contributors": len(contrib)})
    return {"insights_attacked": len(rows), "mean_p_target_contributed": round(float(np.mean([r["p"] for r in rows])), 4) if rows else None,
            "max_p_target_contributed": round(max(r["p"] for r in rows), 4) if rows else None,
            "insights_where_participation_is_certain": sum(r["p"] >= 0.999 for r in rows),
            "prior_participation_rate": round(len(pop.consenting) / len(pop.specs), 4),
            "min_candidate_set": min(r["candidates"] for r in rows) if rows else None,
            "min_contributors_behind_an_insight": min(r["contributors"] for r in rows) if rows else None,
            "note": "P(a tenant matching the insight's public attributes contributed). The attacker is assumed to know the full list of tenants and their public attributes; compare with the prior participation rate"}


def _mean_mix(campaigns: list[dict]) -> np.ndarray:
    v = np.zeros(len(CHANNEL_VOCAB))
    for c in campaigns:
        mix = c["channel_mix"]
        total = sum(mix.values()) or 1.0
        v += np.array([mix.get(ch, 0.0) / total for ch in CHANNEL_VOCAB])
    return v / max(1, len(campaigns))


def aggregate_membership_inference(shared: SharedStore, pop: Population, tenant_store) -> dict:
    from ..auth import TenantContext
    contributors, candidates = pop.contributors_by_qi(), pop.candidates_by_qi()
    cache: dict[str, np.ndarray] = {}

    def own_mix(tid: str) -> np.ndarray:
        if tid not in cache:
            cache[tid] = _mean_mix(tenant_store.scoped(TenantContext(tid, "attacker-knowledge", ("system",))).list_campaigns())
        return cache[tid]

    labels, scores, insights_used = [], [], 0
    for i in shared.query_insights(limit=10_000):
        key = (i["industry_bucket"], i["region"], i["budget_band"], i["objective"])
        cand, contrib = candidates.get(key, set()), contributors.get(key, set())
        if not (cand - contrib) or not contrib:
            continue                                   # needs at least one member and one non-member to measure anything
        mix = np.array([i["channel_mix"].get(ch, 0.0) for ch in CHANNEL_VOCAB])
        for t in cand:
            labels.append(1 if t in contrib else 0)
            scores.append(-float(np.abs(mix - own_mix(t)).sum()))
        insights_used += 1
    auc = float(roc_auc_score(labels, scores)) if len(set(labels)) == 2 else None
    return {"insights_attacked": insights_used, "pairs": len(labels), "auc": round(auc, 4) if auc is not None else None, "chance_auc": 0.5}
