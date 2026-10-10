"""Authentication -> TenantContext. The tenant identity ALWAYS comes from the token, never from the request body."""
from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass
from typing import Callable

import jwt
from fastapi import Depends, HTTPException, Request, status

from .config import Settings

_TENANT_KEY = re.compile(r"^tenant[_\-]?id$", re.IGNORECASE)


@dataclass(frozen=True)
class TenantContext:
    tenant_id: str
    user_id: str
    roles: tuple[str, ...] = ()

    def has_role(self, role: str) -> bool:
        return role in self.roles

    @classmethod
    def system(cls, tenant_id: str) -> "TenantContext":
        """Context used by trusted batch jobs (e.g. the nightly sharing pipeline) acting for one tenant at a time."""
        return cls(tenant_id=tenant_id, user_id="system", roles=("system",))


def create_token(tenant_id: str, user_id: str, roles: list[str], settings: Settings, expires_in: int = 3600) -> str:
    payload = {"tenant_id": tenant_id, "sub": user_id, "roles": roles, "exp": int(time.time()) + expires_in}
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def _from_token(token: str, settings: Settings) -> TenantContext:
    try:
        claims = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except jwt.PyJWTError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid or expired token") from exc
    tenant_id = str(claims.get("tenant_id") or "").strip()
    if not tenant_id:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "token has no tenant_id claim")
    return TenantContext(tenant_id, str(claims.get("sub") or "unknown"), tuple(claims.get("roles") or ()))


async def get_tenant_context(request: Request) -> TenantContext:
    settings: Settings = request.app.state.settings
    header = request.headers.get("authorization", "")
    if header.lower().startswith("bearer "):
        return _from_token(header[7:].strip(), settings)
    if settings.allow_dev_auth and request.headers.get("x-dev-tenant"):
        roles = tuple(r.strip() for r in request.headers.get("x-dev-roles", "").split(",") if r.strip())
        return TenantContext(request.headers["x-dev-tenant"].strip(), request.headers.get("x-dev-user", "dev-user"), roles)
    raise HTTPException(status.HTTP_401_UNAUTHORIZED, "missing credentials")


def _has_tenant_key(node: object) -> bool:
    if isinstance(node, dict):
        return any(_TENANT_KEY.match(str(k)) or _has_tenant_key(v) for k, v in node.items())
    if isinstance(node, list):
        return any(_has_tenant_key(v) for v in node)
    return False


async def reject_tenant_id_in_request(request: Request) -> None:
    """Router-level dependency: any `tenant_id` in the query string or JSON body is refused outright."""
    if any(_TENANT_KEY.match(k) for k in request.query_params.keys()):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "tenant_id must not be sent; it is taken from the auth token")
    raw = await request.body()
    if raw:
        try:
            body = json.loads(raw)
        except ValueError:
            return  # malformed JSON is reported by FastAPI's own validation
        if _has_tenant_key(body):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "tenant_id must not be sent; it is taken from the auth token")


def require_roles(*roles: str) -> Callable[..., TenantContext]:
    async def _dep(ctx: TenantContext = Depends(get_tenant_context)) -> TenantContext:
        if not any(ctx.has_role(r) for r in roles):
            raise HTTPException(status.HTTP_403_FORBIDDEN, f"requires role: {' or '.join(roles)}")
        return ctx

    return _dep
