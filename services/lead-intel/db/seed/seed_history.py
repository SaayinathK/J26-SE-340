# services/lead-intel/db/seed/seed_history.py — OPTIONAL: put a first score in the history for some leads
# Scores the top N leads of each group (hot, warm, cold) of one tenant with the REAL model and saves
# them with source='seed', so the Lead history page is not empty in a demo. Nothing is invented:
# advice and outcomes only appear when someone presses "Get advice" or "Did they buy?".
# Docker:  docker compose exec lead-intel python db/seed/seed_history.py tenant_a 5
# Local:   cd services/lead-intel ; python db/seed/seed_history.py tenant_a 5
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from repositories import get_repo                           # noqa: E402
from services.alerts import check_alert                     # noqa: E402
from services.dashboard import scored_leads                 # noqa: E402
from services.scoring import confidence, find_lead, score_lead   # noqa: E402

tenant = sys.argv[1] if len(sys.argv) > 1 else "tenant_a"
n = int(sys.argv[2]) if len(sys.argv) > 2 else 5
t = scored_leads(tenant)
saved = 0
for seg in ("hot", "warm", "cold"):
    for lead_id in t[t.segment == seg].sort_values(["score", "contact_id"], ascending=[False, True]).head(n).contact_id:
        s = score_lead(find_lead(tenant, lead_id))
        check_alert(tenant, s, confidence(s["score"], s["segment"]), source="seed")
        saved += 1
print(f"{tenant}: scored {saved} leads into the history ({get_repo().kind} storage)")
