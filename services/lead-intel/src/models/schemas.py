# services/lead-intel/src/models/schemas.py — request bodies the API accepts (validated by pydantic)
from typing import Literal

from pydantic import BaseModel


class Lead(BaseModel):
    lead_id: str
    source: str | None = None
    lead_origin: str | None = None
    last_activity: str | None = None
    occupation: str | None = None
    specialization: str | None = None
    total_visits: float | None = None
    time_on_site_sec: float = 0
    pages_per_visit: float | None = None


class Outcome(BaseModel):
    outcome: Literal["won", "lost"]
