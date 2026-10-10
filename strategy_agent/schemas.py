"""All Pydantic v2 models. Request models forbid unknown fields, so a `tenant_id` in a body is rejected."""
from __future__ import annotations

import re
import uuid
from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

ObjectiveType = Literal["lead_gen", "awareness", "retention", "sales"]
ConsentScope = Literal["channel_mix", "budget_split", "timeline", "messaging_angles", "outcome_metrics"]
ALL_SCOPES: tuple[str, ...] = ("channel_mix", "budget_split", "timeline", "messaging_angles", "outcome_metrics")
SHARE_TOLERANCE = 0.02


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


def _norm_channel(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", name.strip().lower()).strip("_")


# ----------------------------------------------------------------------------- request building blocks
class BusinessProfile(_Strict):
    industry: str = Field(min_length=1)
    business_model: Literal["B2B", "B2C"]
    target_audience: str = Field(min_length=1)
    region: str = Field(min_length=1)
    brand_tone: str = "professional"
    monthly_budget: float = Field(gt=0)
    # Optional names. They are stored only in the tenant's own DB and feed the PII recognisers
    # (brand / product / competitor names must never reach the shared store).
    business_name: Optional[str] = None
    brand_names: list[str] = Field(default_factory=list)
    product_names: list[str] = Field(default_factory=list)
    competitor_names: list[str] = Field(default_factory=list)


class Objective(_Strict):
    type: ObjectiveType
    target_kpi: str
    target_value: float
    time_horizon: str = "8 weeks"

    @property
    def horizon_weeks(self) -> int:
        m = re.search(r"(\d+)\s*(week|wk|month|day)", self.time_horizon.lower())
        if not m:
            return 8
        n, unit = int(m.group(1)), m.group(2)
        return max(1, n * 4 if unit == "month" else (round(n / 7) if unit == "day" else n))


class Constraints(_Strict):
    channels_allowed: list[str] = Field(default_factory=list)
    channels_blocked: list[str] = Field(default_factory=list)
    budget_cap: Optional[float] = Field(default=None, gt=0)
    compliance_notes: list[str] = Field(default_factory=list)

    @field_validator("channels_allowed", "channels_blocked")
    @classmethod
    def _norm(cls, v: list[str]) -> list[str]:
        return [_norm_channel(c) for c in v if c.strip()]


class GenerateRequest(_Strict):
    """No tenant_id here: the tenant always comes from the auth token."""

    business_profile: BusinessProfile
    objective: Objective
    constraints: Constraints = Field(default_factory=Constraints)
    use_shared_insights: bool = True
    n_strategies: int = Field(default=3, ge=1, le=5)


# ----------------------------------------------------------------------------- strategy (output)
class ChannelAllocation(_Strict):
    channel: str
    budget_share: float = Field(ge=0.0, le=1.0)

    @field_validator("channel")
    @classmethod
    def _norm(cls, v: str) -> str:
        return _norm_channel(v)


class TimelineItem(_Strict):
    week: int = Field(ge=1)
    actions: list[str]


class KPI(_Strict):
    name: str
    target: float


class ExpectedUplift(_Strict):
    metric: str
    low: float
    high: float

    @model_validator(mode="after")
    def _ordered(self) -> "ExpectedUplift":
        if self.low > self.high:
            raise ValueError("expected_uplift.low must be <= high")
        return self


class Evidence(_Strict):
    tenant_sources: list[str] = Field(default_factory=list)
    shared_insights: list[str] = Field(default_factory=list)


class Strategy(_Strict):
    strategy_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    title: str
    summary: str
    channels: list[ChannelAllocation] = Field(min_length=1)
    audience_segments: list[str]
    messaging_angles: list[str]
    timeline: list[TimelineItem]
    kpis: list[KPI]
    expected_uplift: ExpectedUplift
    rationale: str
    evidence: Evidence = Field(default_factory=Evidence)
    confidence: float = Field(ge=0.0, le=1.0)
    rank: int = Field(default=1, ge=1)

    @model_validator(mode="after")
    def _shares_sum_to_one(self) -> "Strategy":
        total = sum(c.budget_share for c in self.channels)
        if abs(total - 1.0) > SHARE_TOLERANCE:
            raise ValueError(f"channel budget_share must sum to ~1.0, got {total:.3f}")
        return self


class GenerateResponse(BaseModel):
    recommendation_id: str
    model_version: str
    adapter_id: str
    generator_used: str
    strategies: list[Strategy]
    evidence_ids: Evidence
    ranking: dict
    warnings: list[str] = Field(default_factory=list)


# ----------------------------------------------------------------------------- consent and shared insights
class ConsentUpdate(_Strict):
    opted_in: bool
    scopes: list[ConsentScope] = Field(default_factory=list)
    consent_version: str = "v1"


class ConsentSettings(BaseModel):
    opted_in: bool = False
    scopes: list[ConsentScope] = Field(default_factory=list)
    consent_version: str = "v1"
    granted_by: Optional[str] = None
    granted_at: Optional[datetime] = None
    revoked_at: Optional[datetime] = None


class SharedInsight(BaseModel):
    """A published, aggregated insight. It contains no tenant identifier of any kind. `contribution_id` is its opaque id
    (the same value a Strategy lists under evidence.shared_insights)."""

    contribution_id: str
    industry_bucket: str
    region: str
    budget_band: str
    objective: str
    channel_mix: dict[str, float]
    outcome_metrics: dict[str, float]
    support_count: int
    angle: Optional[str] = None
    summary: str


# ----------------------------------------------------------------------------- feedback and outcomes
class FeedbackRequest(_Strict):
    decision: Literal["accepted", "rejected", "edited"]
    strategy_id: Optional[str] = None  # defaults to the top-ranked strategy
    edited_version: Optional[Strategy] = None
    rating: int = Field(ge=1, le=5)  # required, as listed in the brief
    comment: str = Field(default="", max_length=2000)

    @model_validator(mode="after")
    def _edited_needs_version(self) -> "FeedbackRequest":
        if self.decision == "edited" and self.edited_version is None:
            raise ValueError("decision 'edited' requires edited_version")
        return self


class OutcomeRequest(_Strict):
    """Every field is required, as listed in the brief."""

    impressions: float = Field(ge=0)
    ctr: float = Field(ge=0, le=1)
    cpl: float = Field(ge=0)
    conversion_rate: float = Field(ge=0, le=1)
    roi: float
    spend: float = Field(ge=0)
    period: str = Field(min_length=1)  # a date (YYYY-MM-DD) or a label such as 2026-Q3

    def metrics(self) -> dict[str, float]:
        return {k: float(v) for k, v in self.model_dump(exclude={"period"}).items()}


class FeedbackResponse(BaseModel):
    recommendation_id: str
    reward: Optional[float]
    preference_pairs_created: int


class OutcomeResponse(BaseModel):
    recommendation_id: str
    primary_metric: str
    baseline: Optional[float]
    uplift: Optional[float]
    reward: Optional[float]
    campaign_id: str
    contribution_status: str
