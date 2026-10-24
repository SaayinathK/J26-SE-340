# services/lead-intel/src/repositories/base.py — what every history store must offer
# History = every score, every recommendation and every outcome, per tenant, never overwritten.
# Other agents (Strategy, Email) and Component 2 (continuous learning) read it through the API.
from datetime import datetime, timezone


class RepoUnavailable(Exception):
    """The history store cannot be reached (for example the database container is down)."""


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def recommendation_fields(rec: dict) -> dict:
    """The parts of a recommendation answer that are stored as their own columns."""
    return {"score": rec.get("score"), "segment": rec.get("segment"),
            "next_best_action": rec.get("next_best_action"), "message_draft": rec.get("message_draft"),
            "sources": [{k: s.get(k) for k in ("label", "type", "text")} for s in rec.get("sources") or []],
            "grounded": bool(rec.get("grounded")), "policy_check": rec.get("policy_check"),
            "policy_rule": rec.get("policy_rule"),
            "confidence": rec.get("confidence"), "llm_model": rec.get("llm_model"),
            "retrieval_method": rec.get("retrieval_method"), "latency_sec": rec.get("latency_sec")}


def summarise(scores: list[dict], recs: list[dict], outcomes: list[dict]) -> list[dict]:
    """One row per lead that has history, newest activity first (rows must be oldest -> newest)."""
    leads: dict[str, dict] = {}

    def entry(lead_id):
        return leads.setdefault(lead_id, {"lead_id": lead_id, "scores": 0, "recommendations": 0, "outcomes": 0,
                                          "last_score": None, "last_segment": None, "last_outcome": None,
                                          "last_at": None})

    for r in scores:
        e = entry(r["lead_id"])
        e["scores"] += 1
        e["last_score"], e["last_segment"] = r["score"], r["segment"]
        e["last_at"] = max(e["last_at"] or "", r["created_at"])
    for r in recs:
        e = entry(r["lead_id"])
        e["recommendations"] += 1
        e["last_at"] = max(e["last_at"] or "", r["created_at"])
    for r in outcomes:
        e = entry(r["lead_id"])
        e["outcomes"] += 1
        e["last_outcome"] = r["outcome"]
        e["last_at"] = max(e["last_at"] or "", r["created_at"])
    return sorted(leads.values(), key=lambda e: (e["last_at"] or "", e["lead_id"]), reverse=True)


class HistoryRepo:
    kind = "base"

    def add_score(self, tenant: str, lead_id: str, row: dict) -> dict: ...
    def last_score(self, tenant: str, lead_id: str) -> dict | None: ...
    def add_recommendation(self, tenant: str, lead_id: str, rec: dict) -> dict: ...
    def add_outcome(self, tenant: str, lead_id: str, row: dict) -> dict: ...
    def outcomes(self, tenant: str) -> list[dict]: ...
    def lead_history(self, tenant: str, lead_id: str) -> dict: ...
    def leads_summary(self, tenant: str) -> list[dict]: ...
