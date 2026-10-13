"""Shared FastAPI dependencies. The repo is ALWAYS built from the authenticated TenantContext."""
from __future__ import annotations

from fastapi import Depends, Request

from ..auth import TenantContext, get_tenant_context
from ..db.tenant_store import TenantRepo


def get_repo(request: Request, ctx: TenantContext = Depends(get_tenant_context)) -> TenantRepo:
    return request.app.state.tenant_store.scoped(ctx)
