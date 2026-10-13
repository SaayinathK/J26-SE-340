from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request

from ...auth import TenantContext, get_tenant_context, reject_tenant_id_in_request
from ...generation.service import InfeasibleRequest
from ...schemas import GenerateRequest, GenerateResponse

router = APIRouter(prefix="/v1/strategy", tags=["generate"], dependencies=[Depends(reject_tenant_id_in_request)])


@router.post("/generate", response_model=GenerateResponse)
def generate(body: GenerateRequest, request: Request, ctx: TenantContext = Depends(get_tenant_context)) -> GenerateResponse:
    try:
        return request.app.state.service.generate(ctx, body)
    except InfeasibleRequest as exc:
        raise HTTPException(422, str(exc)) from exc
