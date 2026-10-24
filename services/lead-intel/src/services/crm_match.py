# services/lead-intel/src/services/crm_match.py — is the lead being scored already in this tenant's CRM?
# If the Lead ID exists in the CRM but the typed details are different, the score is a "what-if"
# (for the changed details), not the score of the real lead. A what-if is never saved to the lead's
# history and never raises an alert, so the history only holds scores of the real CRM record.
import math

from services.features import CATEGORICAL
from services.scoring import find_lead, score_lead

NUMBERS = ["total_visits", "time_on_site_sec", "pages_per_visit"]
LABELS = {"source": "How they found us", "lead_origin": "How the lead was added", "last_activity": "Last action",
          "occupation": "Job", "specialization": "Interest", "total_visits": "Website visits",
          "time_on_site_sec": "Time on website", "pages_per_visit": "Pages per visit"}


def _text(v):
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return None
    v = str(v).strip()
    return v or None


def _number(v):
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return None
    return float(v)


def changed_fields(crm: dict, lead: dict) -> list[str]:
    """CRM fields whose value differs from what was typed (text exact, numbers within 0.05)."""
    out = [c for c in CATEGORICAL if _text(crm.get(c)) != _text(lead.get(c))]
    for c in NUMBERS:
        a, b = _number(crm.get(c)), _number(lead.get(c))
        if (a is None) != (b is None) or (a is not None and abs(a - b) > 0.05):
            out.append(c)
    return out


def compare_with_crm(tenant: str, lead: dict) -> dict | None:
    """None if the Lead ID is not in this tenant's CRM, else the real CRM score and what was changed."""
    crm = find_lead(tenant, lead["lead_id"])
    if crm is None:
        return None
    real = score_lead(crm)
    changed = changed_fields(crm, lead)
    return {"score": real["score"], "segment": real["segment"],
            "changed": [{"field": c, "label": LABELS[c]} for c in changed]}
