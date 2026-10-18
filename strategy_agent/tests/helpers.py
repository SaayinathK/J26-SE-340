"""Shared test helpers. The API requires complete feedback and outcome payloads (as the brief lists them); these fill the defaults."""
from __future__ import annotations

OUTCOME_DEFAULTS = {"impressions": 100_000, "ctr": 0.02, "cpl": 12.0, "conversion_rate": 0.03, "roi": 2.0, "spend": 4000.0, "period": "2026-08-01"}


def fb(d: dict) -> dict:
    """A complete feedback payload: rating and comment filled in unless given."""
    return {"rating": 4, "comment": "", **d}


def out(d: dict) -> dict:
    """A complete outcome payload: every metric filled in unless given."""
    return {**OUTCOME_DEFAULTS, **d}
