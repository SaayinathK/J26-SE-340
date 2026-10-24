"""THE CORE NOVELTY: the consent-gated anonymisation pipeline.

  1. consent check (and drop anything outside the granted scopes)
  2. PII removal (Presidio + regex + the tenant's own brand / product / competitor names)
  3. tenant de-identification (opaque contribution_id; the ONLY tenant<->contribution link is the ledger in the tenant's own DB)
  4. generalisation (industry bucket, region, budget band, quarter, abstract messaging angle)
  5. k-anonymity gate (publish only groups backed by >= k DISTINCT tenants)
  6. aggregation (+ optional Laplace noise on numeric aggregates)
  7. validation (re-scan everything that would be stored or published; reject and log only entity TYPES, never raw data)
  8. write to the shared store (a separate DB that only this module writes)

Per-campaign steps 1-4 and 7-8 run in `process_campaign`; steps 5-7 for the published aggregates run in `rebuild_insights`.
"""
from __future__ import annotations

import argparse
import logging
import uuid
from dataclasses import dataclass
from typing import Optional

import numpy as np

from ..auth import TenantContext
from ..channels import CHANNEL_VOCAB, OTHER, canonical_mix
from ..config import Settings, get_settings
from ..db.shared_store import SharedStore
from ..db.tenant_store import TenantStore
from ..learning.feedback import primary_metric, uplift_from
from . import k_anonymity as kanon
from .anonymizer import (ANGLE_TAXONOMY, BUDGET_BANDS, DURATION_BUCKETS, INDUSTRY_BUCKETS, PERIOD_PATTERN, REGION_BUCKETS, Anonymizer,
                         abstract_angle, budget_band, duration_bucket, industry_bucket, period_bucket, region_bucket, tenant_terms)

log = logging.getLogger("strategy_agent.privacy")

# Only ratios are ever shared. Absolute spend / impressions can reveal a tenant's exact budget or size.
SHAREABLE_METRICS = ("ctr", "conversion_rate", "cpl", "roi", "uplift")
# The second-layer scan on closed-vocabulary values only flags STRUCTURED identifiers. NER labels such as PERSON / LOCATION
# fire on harmless vocabulary words ("lead gen", "south asia") and would wrongly reject good records.
STRUCTURED_PII = frozenset({"EMAIL_ADDRESS", "PHONE_NUMBER", "URL", "IP_ADDRESS", "CREDIT_CARD", "IBAN_CODE", "US_SSN", "ORG_BRAND"})
FORBIDDEN_KEYS = {"tenant_id", "tenant", "campaign_id", "business_name", "brand", "brand_names", "email", "phone", "account_id", "monthly_budget"}


@dataclass
class PipelineResult:
    campaign_id: str
    status: str  # published_contribution | rejected | skipped_no_consent
    reason: str = ""
    contribution_id: Optional[str] = None


class ConsentGatedPipeline:
    def __init__(self, tenants: TenantStore, shared: SharedStore, anonymizer: Anonymizer, settings: Settings, noise_seed: Optional[int] = None) -> None:
        self.tenants, self.shared, self.anon, self.settings = tenants, shared, anonymizer, settings
        self._rng = np.random.default_rng(noise_seed)

    # ------------------------------------------------------------------ per-campaign (steps 1-4, 7, 8)
    def process_campaign(self, ctx: TenantContext, campaign: dict) -> PipelineResult:
        repo = self.tenants.scoped(ctx)
        cid = campaign["id"]

        # 1. consent check
        consent = repo.get_consent()
        if not consent["opted_in"] or consent["revoked_at"]:
            return PipelineResult(cid, "skipped_no_consent", "no active consent")
        scopes = set(consent["scopes"])
        if not scopes:
            return PipelineResult(cid, "skipped_no_consent", "no scopes granted")

        # 2. PII removal on all free text, using the tenant's own names as extra recognisers
        terms = tenant_terms(repo.get_profile())
        clean_text = self.anon.redact(campaign.get("messaging_text") or "", terms)

        # 3. de-identification: opaque id; the token only lets the k-gate count distinct tenants
        contribution_id = str(uuid.uuid4())
        token = repo.get_or_create_contributor_token()

        # 4. generalisation, limited to the granted scopes
        rec: dict = {
            "contribution_id": contribution_id,
            "contributor_token": token,
            "industry_bucket": industry_bucket(campaign["industry"]),
            "region": region_bucket(campaign["region"]),
            "budget_band": budget_band(campaign["monthly_budget"]) if "budget_split" in scopes else "undisclosed",
            "objective": campaign["objective"],
            "channel_mix": {},
            "outcome_metrics": {},
            "angle": None,
            "duration_bucket": None,
            "period": None,
        }
        if "channel_mix" in scopes:
            mix = canonical_mix(campaign["channel_mix"])
            if "budget_split" not in scopes:  # channels only: shares are withheld, so use an even split
                mix = {c: round(1 / len(mix), 4) for c in mix}
            rec["channel_mix"] = mix
        if "outcome_metrics" in scopes and campaign.get("outcome"):
            rec["outcome_metrics"] = {k: round(float(v), 4) for k, v in campaign["outcome"].items() if k in SHAREABLE_METRICS}
            metric, lower_is_better = primary_metric(campaign["objective"])      # uplift = improvement over THIS tenant's own baseline
            u = uplift_from(campaign["outcome"].get(metric), repo.objective_baseline(campaign["objective"], metric), lower_is_better)
            if u is not None:
                rec["outcome_metrics"]["uplift"] = round(max(-1.0, min(1.0, u)), 4)
        if "messaging_angles" in scopes and clean_text.strip():
            rec["angle"] = abstract_angle(clean_text)
        if "timeline" in scopes:
            rec["duration_bucket"] = duration_bucket(campaign.get("duration_weeks"))
            rec["period"] = period_bucket(campaign.get("period_date"))

        if not (rec["channel_mix"] or rec["outcome_metrics"] or rec["angle"] or rec["duration_bucket"]):
            repo.set_share_status(cid, "rejected", "no shareable fields in granted scopes")
            return PipelineResult(cid, "rejected", "no shareable fields in granted scopes")

        # 7. validation: re-scan everything that would be stored (second PII pass, after generalisation)
        problems = self._validate_record(rec, terms)
        if problems:
            repo.set_share_status(cid, "rejected", problems)
            log.info("contribution rejected: %s", problems)  # entity types only, never raw data
            return PipelineResult(cid, "rejected", problems)

        # 8. write. Ledger FIRST: if the shared write fails we can undo; if the order were reversed an orphan could not be revoked.
        repo.add_ledger(contribution_id, cid)
        try:
            self.shared.add_contribution(rec)
        except Exception:
            repo.remove_ledger(contribution_id)
            raise
        repo.set_share_status(cid, "shared", "")
        return PipelineResult(cid, "published_contribution", "", contribution_id)

    def _vocab_problems(self, rec: dict) -> str:
        """Every generalised field must be a member of its closed vocabulary. This is stronger than scanning for PII: a value
        outside the vocabulary (free text, a brand, an address ...) is refused no matter what it looks like."""
        bad = []
        if rec["industry_bucket"] not in INDUSTRY_BUCKETS: bad.append("industry_bucket")
        if rec["region"] not in REGION_BUCKETS: bad.append("region")
        if rec["budget_band"] not in BUDGET_BANDS: bad.append("budget_band")
        if rec["objective"] not in ("lead_gen", "awareness", "retention", "sales"): bad.append("objective")
        if rec.get("angle") is not None and rec["angle"] not in ANGLE_TAXONOMY: bad.append("angle")
        if rec.get("duration_bucket") is not None and rec["duration_bucket"] not in DURATION_BUCKETS: bad.append("duration_bucket")
        if rec.get("period") is not None and not PERIOD_PATTERN.match(rec["period"]): bad.append("period")
        if any(ch not in CHANNEL_VOCAB and ch != OTHER for ch in rec["channel_mix"]): bad.append("channel_mix")
        return ("not_in_vocabulary:" + ",".join(bad)) if bad else ""

    def _pii_problems(self, rec: dict, terms: list[str]) -> str:
        """Second layer: re-scan the remaining strings with Presidio + regex + the tenant's names (the region bucket is a
        closed vocabulary of continents, which an NER model would otherwise flag as a LOCATION)."""
        strings = [rec["industry_bucket"], rec["budget_band"], rec["objective"], rec.get("angle"), rec.get("duration_bucket"),
                   rec.get("period"), *rec["channel_mix"].keys()]
        found: set[str] = set()
        for text in strings:
            if text:
                found.update(self._structured_pii(text, terms))
        return ("pii_remaining:" + ",".join(sorted(found))) if found else ""

    def _structured_pii(self, text: str, terms: list[str]) -> set[str]:
        return set(self.anon.entities_in(text.replace("_", " "), terms)) & STRUCTURED_PII

    def _validate_record(self, rec: dict, terms: list[str]) -> str:
        bad_keys = FORBIDDEN_KEYS & set(rec)
        if bad_keys:
            return "forbidden_keys:" + ",".join(sorted(bad_keys))
        return self._vocab_problems(rec) or self._pii_problems(rec, terms)

    def process_pending(self, ctx: TenantContext) -> list[PipelineResult]:
        repo = self.tenants.scoped(ctx)
        return [self.process_campaign(ctx, c) for c in repo.list_pending_share_campaigns()]

    # ------------------------------------------------------------------ published aggregates (steps 5, 6, 7)
    def rebuild_insights(self) -> dict:
        contribs = self.shared.list_contributions()
        groups = kanon.group_by_qi(contribs)
        publishable, held_back = kanon.k_gate(groups, self.settings.k_anonymity)  # 5. k-anonymity gate

        insights, dropped = [], 0
        for key, group in sorted(publishable.items()):
            mix, metrics = kanon.aggregate_group(group, self.settings.laplace_epsilon, self.settings.enable_laplace_noise, self._rng)  # 6.
            insight = {
                "insight_id": kanon.insight_id_for(key), "industry_bucket": key[0], "region": key[1], "budget_band": key[2],
                "objective": key[3], "channel_mix": mix, "outcome_metrics": metrics,
                "support_count": kanon.distinct_contributors(group), "angle": kanon.most_common_angle(group),
                "summary": kanon.build_summary(key, mix, metrics, kanon.distinct_contributors(group)),
            }
            # 7. validation of the published text with generic PII detection
            if self._structured_pii(insight["summary"], []):
                dropped += 1
                continue
            insights.append(insight)
        self.shared.replace_insights(insights)
        return {"contributions": len(contribs), "groups": len(groups), "published": len(insights),
                "held_back_below_k": len(held_back), "dropped_by_validation": dropped}

    def run_batch(self) -> dict:
        """Nightly job: share every pending campaign of every opted-in tenant, then rebuild the published insights."""
        counts = {"published_contribution": 0, "rejected": 0, "skipped_no_consent": 0}
        tenant_ids = self.tenants.list_tenants_with_active_consent()
        for tid in tenant_ids:
            for r in self.process_pending(TenantContext.system(tid)):
                counts[r.status] = counts.get(r.status, 0) + 1
        return {"tenants": len(tenant_ids), **counts, **self.rebuild_insights()}

    # ------------------------------------------------------------------ revocation
    def revoke(self, ctx: TenantContext, rebuild: bool = True) -> dict:
        """Delete every contribution this tenant ever made, using only the tenant-side ledger."""
        repo = self.tenants.scoped(ctx)
        ids = repo.ledger_contribution_ids()
        deleted = self.shared.delete_contributions(ids)
        repo.clear_ledger()
        reset = repo.reset_share_status()
        out = {"contributions_deleted": deleted, "campaigns_reset": reset}
        if rebuild:
            out.update(self.rebuild_insights())
        return out


def main() -> None:
    parser = argparse.ArgumentParser(description="Consent-gated sharing pipeline")
    parser.add_argument("--batch", action="store_true", help="share pending campaigns of all opted-in tenants and rebuild insights")
    args = parser.parse_args()
    settings = get_settings()
    pipe = ConsentGatedPipeline(TenantStore(settings.resolve(settings.tenant_db_path)), SharedStore(settings.resolve(settings.shared_db_path)),
                                Anonymizer(), settings)
    if args.batch:
        print(pipe.run_batch())
    else:
        parser.print_help()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    main()
