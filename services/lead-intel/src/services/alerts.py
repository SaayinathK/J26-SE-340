# services/lead-intel/src/services/alerts.py — C3-11 hot -> cold alert (FR8) + saving every score
# Each new score is compared with the last saved score of the SAME lead in the SAME tenant,
# then saved to the history (never overwritten). The same score twice is not saved again.
import logging

from repositories import RepoUnavailable, get_repo
from services.scoring import RANK

log = logging.getLogger("c3.alerts")


def check_alert(tenant: str, result: dict, conf: dict | None = None, source: str = "api") -> dict | None:
    """Return a segment_drop alert (or None) and save this score in the lead's history."""
    repo = get_repo()
    try:
        prev = repo.last_score(tenant, result["lead_id"])
        if prev and prev["score"] == result["score"]:
            return prev.get("alert")              # same score again -> same answer (deterministic)
        alert = None
        if prev and RANK[result["segment"]] < RANK[prev["segment"]]:
            alert = {"type": "segment_drop", "from": prev["segment"], "to": result["segment"],
                     "previous_score": prev["score"], "score": result["score"],
                     "previous_scored_at": prev["created_at"],
                     "message": f"Lead dropped from {prev['segment']} to {result['segment']} "
                                f"({prev['score']} -> {result['score']}). Follow up before it goes cold."}
        repo.add_score(tenant, result["lead_id"], {
            "score": result["score"], "segment": result["segment"], "top_factors": result.get("top_factors"),
            "confidence": conf, "alert": alert, "model_version": result["model_version"], "source": source})
        return alert
    except RepoUnavailable as e:                  # scoring still works when the history store is down
        log.warning("history store unavailable, score not saved: %s", e)
        return None
