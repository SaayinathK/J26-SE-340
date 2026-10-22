# services/lead-intel/src/services/history.py — the output history of the agent, per lead (FR10)
# Used by the "Lead history" page, and by the Strategy agent, the Email agent and Component 2.
from repositories import get_repo
from services.dashboard import lead_profile


def overview(tenant: str) -> dict:
    """Every lead that has history in this tenant, newest activity first, plus totals."""
    repo = get_repo()
    leads = repo.leads_summary(tenant)
    return {"storage": repo.kind,
            "totals": {"leads": len(leads),
                       "scores": sum(x["scores"] for x in leads),
                       "recommendations": sum(x["recommendations"] for x in leads),
                       "outcomes": sum(x["outcomes"] for x in leads)},
            "leads": leads}


def for_lead(tenant: str, lead_id: str) -> dict | None:
    """All outputs for one lead: a timeline (newest first) and the score series (oldest first)."""
    repo = get_repo()
    h = repo.lead_history(tenant, lead_id)
    profile = lead_profile(tenant, lead_id)
    if profile is None and not any(h.values()):
        return None                                  # not this tenant's lead, and no history
    events = [{"type": kind, **r, "_i": i}
              for kind, rows in (("score", h["scores"]), ("recommendation", h["recommendations"]),
                                 ("outcome", h["outcomes"]))
              for i, r in enumerate(rows)]                    # rows come oldest -> newest
    order = {"outcome": 0, "recommendation": 1, "score": 2}   # same moment: result, advice, then score
    events.sort(key=lambda e: (e["created_at"], -order[e["type"]], e["_i"]), reverse=True)
    for e in events:
        del e["_i"]
    return {"lead_id": lead_id, "storage": repo.kind, "profile": profile,
            "counts": {k: len(v) for k, v in h.items()},
            "score_series": [{"at": r["created_at"], "score": r["score"], "segment": r["segment"],
                              "source": r["source"]} for r in h["scores"]],
            "events": events}
