"""Consent management. Only a `tenant_admin` may read or change a tenant's sharing consent.

Rules that make consent real rather than decorative:
  * opting in needs at least one scope;
  * opting OUT (revocation) deletes every contribution of the tenant from the shared store, via the tenant-side ledger;
  * NARROWING scopes also purges past contributions (they were made under the broader consent) and re-shares under the new scopes;
  * re-opting in rotates the tenant's contributor token, so new contributions cannot be linked to old ones.
"""
from __future__ import annotations

from datetime import datetime, timezone

from ..auth import TenantContext
from ..db.tenant_store import TenantRepo
from ..schemas import ConsentSettings, ConsentUpdate
from .pipeline import ConsentGatedPipeline


def get_consent(repo: TenantRepo) -> ConsentSettings:
    return ConsentSettings(**repo.get_consent())


def update_consent(repo: TenantRepo, ctx: TenantContext, update: ConsentUpdate, pipeline: ConsentGatedPipeline) -> ConsentSettings:
    if not ctx.has_role("tenant_admin"):  # defence in depth: the API route enforces this too
        raise PermissionError("only a tenant_admin may change sharing consent")
    prev = repo.get_consent()
    now = datetime.now(timezone.utc).isoformat()

    if update.opted_in:
        if not update.scopes:
            raise ValueError("opting in requires at least one scope")
        was_active = prev["opted_in"] and not prev["revoked_at"]
        narrowed = was_active and not set(prev["scopes"]).issubset(update.scopes)
        if narrowed:
            pipeline.revoke(ctx, rebuild=False)  # purge what was shared under the broader consent
        if not was_active:
            repo.get_or_create_contributor_token(rotate=True)
        repo.set_consent(opted_in=True, scopes=sorted(set(update.scopes)), consent_version=update.consent_version,
                         granted_by=ctx.user_id, granted_at=now, revoked_at=None)
        if narrowed or not was_active:
            pipeline.process_pending(ctx)
            pipeline.rebuild_insights()
    else:
        repo.set_consent(opted_in=False, scopes=[], consent_version=update.consent_version, granted_by=prev["granted_by"],
                         granted_at=prev["granted_at"], revoked_at=now)
        pipeline.revoke(ctx)  # delete all contributions + rebuild the published insights without them
    return get_consent(repo)
