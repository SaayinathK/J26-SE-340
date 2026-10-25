# services/lead-intel/src/services/dashboard.py — C3-12 dashboard data (top leads, segment mix, weekly trend)
import pandas as pd

from services.features import CATEGORICAL, NUMERIC
from services.scoring import B, LEADS, segment

DASH_CACHE: dict = {}          # tenant -> scored leads
LIST_PER_SEGMENT = None        # leads per segment sent to the UI lead list (None = all of them)


def scored_leads(tenant: str) -> pd.DataFrame:
    if tenant not in DASH_CACHE:
        t = LEADS[LEADS.tenant == tenant].copy()
        t["score"] = (B["calibrated"].predict_proba(t[NUMERIC + CATEGORICAL])[:, 1] * 100).round().astype(int)
        t["segment"] = t.score.map(segment)
        DASH_CACHE[tenant] = t
    return DASH_CACHE[tenant]


def _txt(v):
    return None if pd.isna(v) else v


def _num(v):
    return None if pd.isna(v) else round(float(v), 1)


def lead_row(r) -> dict:
    """One lead for the UI list: profile fields only (no outcome, no sales tags)."""
    return {"lead_id": r.contact_id, "score": int(r.score), "segment": r.segment,
            "source": _txt(r.source), "lead_origin": _txt(r.lead_origin), "last_activity": _txt(r.last_activity),
            "occupation": _txt(r.occupation), "specialization": _txt(r.specialization), "city": _txt(r.city),
            "total_visits": _num(r.total_visits), "time_on_site_sec": _num(r.time_on_site_sec),
            "pages_per_visit": _num(r.pages_per_visit)}


def lead_profile(tenant: str, lead_id: str) -> dict | None:
    """The lead as the lead list shows it (current CRM score), or None if it is not in this tenant's CRM."""
    t = scored_leads(tenant)
    rows = t[t.contact_id == lead_id]
    return None if rows.empty else lead_row(next(rows.itertuples()))


def dashboard_data(tenant: str) -> dict:
    t = scored_leads(tenant)
    top = t.sort_values(["score", "contact_id"], ascending=[False, True]).head(10)
    week = pd.to_datetime(t.date_added).dt.to_period("W").dt.start_time.dt.date.astype(str)
    trend = t.groupby(week).agg(leads=("converted", "size"), conversion_rate=("converted", "mean"),
                                avg_score=("score", "mean")).round(3)
    seg = t.groupby("segment").agg(leads=("converted", "size"), conversion_rate=("converted", "mean")).round(3)
    return {
        "tenant_leads": int(len(t)),
        "segments": seg.reindex(["hot", "warm", "cold"]).fillna(0).reset_index().to_dict("records"),
        "top_10_hottest": [{"lead_id": r.contact_id, "score": int(r.score), "segment": r.segment,
                            "source": r.source if pd.notna(r.source) else None,
                            "last_activity": r.last_activity if pd.notna(r.last_activity) else None}
                           for r in top.itertuples()],
        "weekly_trend": trend.reset_index(names="week_start").to_dict("records"),
        # the highest-scored leads of EACH segment, so the UI can show hot, warm and cold leads
        "leads": [lead_row(r) for s in ("hot", "warm", "cold")
                  for r in t[t.segment == s].sort_values(["score", "contact_id"], ascending=[False, True])
                  .head(LIST_PER_SEGMENT).itertuples()],
        "dates_are_synthetic": bool(t.date_is_synthetic.all()),
        "note": "Scores use the C3 model on the tenant's historical CRM leads. "
                "Lead dates are synthetic (the dataset has none), so the trend shows the method, not real seasonality.",
    }
