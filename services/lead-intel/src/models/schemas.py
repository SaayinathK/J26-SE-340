# services/lead-intel/src/models/schemas.py — request bodies the API accepts (validated by pydantic)
# Wrong input is refused with HTTP 422 and a plain message, before the model sees it.
# Limits come from the CRM data (max 251 visits, 2,272 s on site, 55 pages per visit) with room to spare.
from typing import Literal

from pydantic import BaseModel, Field, model_validator

Text = Field(default=None, max_length=100)


class Lead(BaseModel):
    lead_id: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_.:\-]+$")
    source: str | None = Text
    lead_origin: str | None = Text
    last_activity: str | None = Text
    occupation: str | None = Text
    specialization: str | None = Text
    total_visits: float | None = Field(default=None, ge=0, le=1000)
    time_on_site_sec: float = Field(default=0, ge=0, le=86400)
    pages_per_visit: float | None = Field(default=None, ge=0, le=200)

    @model_validator(mode="after")
    def visits_match_time_and_pages(self):
        """A lead who never visited cannot have time or pages on the website (true for every CRM record)."""
        if self.total_visits == 0 and (self.time_on_site_sec > 0 or (self.pages_per_visit or 0) > 0):
            raise ValueError("With 0 website visits, time on the website and pages per visit must also be 0.")
        if (self.total_visits or 0) > 0 and self.pages_per_visit == 0:
            raise ValueError("With website visits, pages per visit must be more than 0.")
        return self


class Outcome(BaseModel):
    outcome: Literal["won", "lost"]
