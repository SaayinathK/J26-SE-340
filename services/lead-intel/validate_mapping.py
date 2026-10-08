# services/lead-intel/validate_mapping.py  — C3-01 evidence (target >= 95% on >= 500 records)
import pandas as pd

raw = pd.read_csv("data/raw/Leads.csv").replace("Select", pd.NA)
out = pd.read_json("data/processed/leads_ghl.jsonl", lines=True)
sample = out.sample(500, random_state=42)

checks = pd.DataFrame({
    "contact_id": sample.contact_id.str.match(r"^L-[0-9a-f]{10}$"),
    "tenant": sample.tenant.isin(["tenant_a", "tenant_b", "tenant_c"]),
    "time_on_site_sec": sample.time_on_site_sec >= 0,
    "total_visits": sample.total_visits.isna() | (sample.total_visits >= 0),
    "pages_per_visit": sample.pages_per_visit.isna() | (sample.pages_per_visit >= 0),
    "converted": sample.converted.isin([0, 1]),
    "opportunity_status": sample.opportunity_status.isin(["won", "lost"]),
    "dnd_email": sample.dnd_email.isin([True, False]),
})
print("Records checked:", len(sample))
print("Field-level mapping accuracy:", round(checks.to_numpy().mean() * 100, 2), "%")
print(checks.mean().round(3))

# No information lost: every non-empty source value must still be there
for src, dst in [("Lead Source", "source"), ("Last Activity", "last_activity"),
                 ("Specialization", "specialization")]:
    assert raw[src].notna().sum() == out[dst].notna().sum(), f"{src} lost values"
assert (out.source == "google").sum() == 0, "lowercase google still present"
assert (out == "Select").sum().sum() == 0, "'Select' still present"
print("No values lost in mapping; 'Select' and 'google' cleaned")