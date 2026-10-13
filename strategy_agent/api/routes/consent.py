from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request

from ...auth import TenantContext, reject_tenant_id_in_request, require_roles
from ...privacy.consent import get_consent, update_consent
from ...schemas import ConsentSettings, ConsentUpdate

router = APIRouter(prefix="/v1/strategy/sharing", tags=["consent"], dependencies=[Depends(reject_tenant_id_in_request)])


@router.get("/consent", response_model=ConsentSettings)
def read_consent(request: Request, ctx: TenantContext = Depends(require_roles("tenant_admin"))) -> ConsentSettings:
    return get_consent(request.app.state.tenant_store.scoped(ctx))


@router.put("/consent", response_model=ConsentSettings)
def write_consent(body: ConsentUpdate, request: Request, ctx: TenantContext = Depends(require_roles("tenant_admin"))) -> ConsentSettings:
    repo = request.app.state.tenant_store.scoped(ctx)
    try:
        return update_consent(repo, ctx, body, request.app.state.pipeline)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
