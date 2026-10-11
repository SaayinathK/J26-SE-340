"""Feedback + outcome handling. All of it runs inside the calling tenant's scope."""
from __future__ import annotations

import logging
from datetime import date
from typing import Optional

from ..auth import TenantContext
from ..config import Settings
from ..db.tenant_store import TenantRepo
from ..privacy.pipeline import ConsentGatedPipeline
from ..schemas import FeedbackRequest, FeedbackResponse, OutcomeRequest, OutcomeResponse
from .feedback import compute_reward, explicit_feedback_score, primary_metric, uplift_from
from .preference import rebuild_pairs_for

log = logging.getLogger("strategy_agent.learning")


class NotFound(LookupError):
    pass


def _recommendation(repo: TenantRepo, recommendation_id: str) -> dict:
    rec = repo.get_recommendation(recommendation_id)  # tenant-scoped: another tenant's id simply is not found
    if rec is None:
        raise NotFound("recommendation not found")
    return rec


def _refresh_reward(repo: TenantRepo, settings: Settings, recommendation_id: str) -> Optional[float]:
    """reward = w_outcome * clip(uplift) + w_feedback * explicit_feedback, from the latest signals available."""
    feedback = repo.list_feedback(recommendation_id)
    outcome = repo.get_outcome(recommendation_id)
    fb_score = explicit_feedback_score(feedback[-1]["decision"], feedback[-1]["rating"]) if feedback else None
    res = compute_reward(outcome["uplift"] if outcome else None, fb_score, settings.reward_weights)
    if res is None:
        return None
    reward, comps = res
    repo.upsert_reward(recommendation_id, reward, comps)
    return reward


def record_feedback(repo: TenantRepo, settings: Settings, recommendation_id: str, body: FeedbackRequest) -> FeedbackResponse:
    rec = _recommendation(repo, recommendation_id)
    ids = {s["strategy_id"] for s in rec["strategies"]}
    strategy_id = body.strategy_id or rec["strategies"][0]["strategy_id"]  # default: the top-ranked strategy
    if strategy_id not in ids:
        raise ValueError("strategy_id does not belong to this recommendation")
    repo.add_feedback(recommendation_id=recommendation_id, decision=body.decision, strategy_id=strategy_id,
                      edited_version=body.edited_version.model_dump() if body.edited_version else None, rating=body.rating, comment=body.comment)
    reward = _refresh_reward(repo, settings, recommendation_id)
    pairs = rebuild_pairs_for(repo, recommendation_id)
    return FeedbackResponse(recommendation_id=recommendation_id, reward=reward, preference_pairs_created=pairs)


def _executed_strategy(rec: dict, feedback: list[dict]) -> dict:
    """The plan that was actually run: an edited version if the tenant edited one, else the accepted strategy, else the top-ranked."""
    top = rec["strategies"][0]
    for fb in reversed(feedback):
        if fb["decision"] == "edited" and fb["edited_version"]:
            return fb["edited_version"]
        if fb["decision"] == "accepted":
            return next((s for s in rec["strategies"] if s["strategy_id"] == fb["strategy_id"]), top)
    return top


def record_outcome(repo: TenantRepo, ctx: TenantContext, settings: Settings, pipeline: ConsentGatedPipeline, recommendation_id: str,
                   body: OutcomeRequest) -> OutcomeResponse:
    rec = _recommendation(repo, recommendation_id)
    req = rec["request"]
    objective = req["objective"]["type"]
    metric, lower_is_better = primary_metric(objective)
    metrics = body.metrics()
    # baseline = this tenant's own history for the same objective, EXCLUDING campaigns the agent itself recommended (no circularity)
    baseline = repo.objective_baseline(objective, metric)
    uplift = uplift_from(metrics.get(metric), baseline, lower_is_better)
    repo.add_outcome(recommendation_id=recommendation_id, metrics=metrics, primary_metric=metric, baseline=baseline, uplift=uplift, period=body.period)
    reward = _refresh_reward(repo, settings, recommendation_id)

    # the executed plan becomes a completed campaign in the tenant's history ...
    plan = _executed_strategy(rec, repo.list_feedback(recommendation_id))
    prof = req["business_profile"]
    period_date = body.period if len(body.period) == 10 and body.period[4] == "-" else date.today().isoformat()
    campaign_id = repo.add_campaign(
        industry=prof["industry"], region=prof["region"], objective=objective, monthly_budget=prof["monthly_budget"], business_model=prof["business_model"],
        channel_mix={c["channel"]: c["budget_share"] for c in plan["channels"]}, duration_weeks=max(t["week"] for t in plan["timeline"]) if plan["timeline"] else None,
        messaging_text=". ".join(plan["messaging_angles"]), outcome=metrics, period_date=period_date, recommendation_id=recommendation_id)

    # ... and, only if the tenant has consented, flows through the anonymisation pipeline (never fails the outcome request)
    status = "skipped_no_consent"
    try:
        results = {r.campaign_id: r for r in pipeline.process_pending(ctx)}
        if campaign_id in results:
            r = results[campaign_id]
            status = r.status if r.status != "rejected" else f"rejected:{r.reason}"
            if r.status == "published_contribution":
                pipeline.rebuild_insights()
    except Exception as exc:  # pragma: no cover - defensive
        log.warning("sharing pipeline error after outcome: %s", type(exc).__name__)
        status = "pipeline_error"
    rebuild_pairs_for(repo, recommendation_id)
    return OutcomeResponse(recommendation_id=recommendation_id, primary_metric=metric, baseline=baseline, uplift=uplift, reward=reward,
                           campaign_id=campaign_id, contribution_status=status)
