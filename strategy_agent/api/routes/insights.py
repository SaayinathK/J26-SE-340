from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Query, Request

from ...auth import TenantContext, get_tenant_context, reject_tenant_id_in_request
from ...schemas import SharedInsight

router = APIRouter(prefix="/v1/strategy", tags=["shared-insights"], dependencies=[Depends(reject_tenant_id_in_request)])


@router.get("/shared-insights", response_model=list[SharedInsight])
def shared_insights(request: Request, industry_bucket: Optional[str] = None, objective: Optional[str] = None,
                    region: Optional[str] = None, limit: int = Query(20, ge=1, le=100),
                    ctx: TenantContext = Depends(get_tenant_context)) -> list[dict]:
    """Anonymised, aggregated, k-anonymity-gated insights. Read-only; the reader object cannot write and has no tenant data."""
    return request.app.state.shared_reader.query_insights(industry_bucket, objective, region, limit)
