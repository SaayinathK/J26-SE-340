from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request

from ...auth import TenantContext, get_tenant_context, reject_tenant_id_in_request
from ...learning.service import NotFound, record_feedback, record_outcome
from ...schemas import FeedbackRequest, FeedbackResponse, OutcomeRequest, OutcomeResponse

router = APIRouter(prefix="/v1/strategy", tags=["learning"], dependencies=[Depends(reject_tenant_id_in_request)])


@router.post("/{recommendation_id}/feedback", response_model=FeedbackResponse)
def feedback(recommendation_id: str, body: FeedbackRequest, request: Request, ctx: TenantContext = Depends(get_tenant_context)) -> FeedbackResponse:
    repo = request.app.state.tenant_store.scoped(ctx)
    try:
        return record_feedback(repo, request.app.state.settings, recommendation_id, body)
    except NotFound as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.post("/{recommendation_id}/outcome", response_model=OutcomeResponse)
def outcome(recommendation_id: str, body: OutcomeRequest, request: Request, ctx: TenantContext = Depends(get_tenant_context)) -> OutcomeResponse:
    repo = request.app.state.tenant_store.scoped(ctx)
    try:
        return record_outcome(repo, ctx, request.app.state.settings, request.app.state.pipeline, recommendation_id, body)
    except NotFound as exc:
        raise HTTPException(404, str(exc)) from exc
