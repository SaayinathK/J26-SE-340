# services/lead-intel/ingest.py  — C3-01
# Converts the Kaggle X Education leads into GHL-style CRM lead records
# split across 3 simulated tenants.
import hashlib
import numpy as np
import pandas as pd

RAW = "data/raw/Leads.csv"
OUT = "data/processed/leads_ghl.jsonl"
TENANTS = ["tenant_a", "tenant_b", "tenant_c"]

MAPPING = {                      # Kaggle column -> GHL-style field
    "Lead Source": "source",
    "Lead Origin": "lead_origin",
    "Do Not Email": "dnd_email",
    "Do Not Call": "dnd_call",
    "TotalVisits": "total_visits",
    "Total Time Spent on Website": "time_on_site_sec",
    "Page Views Per Visit": "pages_per_visit",
    "Last Activity": "last_activity",
    "Last Notable Activity": "last_notable_activity",
    "What is your current occupation": "occupation",
    "Specialization": "specialization",
    "Country": "country",
    "City": "city",
    "Tags": "tags",
    "Lead Quality": "lead_quality",
    "Lead Profile": "lead_profile",
    "Converted": "converted",
}

def anon_id(x) -> str:
    """Replace the Prospect ID with a short anonymous ID."""
    return "L-" + hashlib.sha256(str(x).encode()).hexdigest()[:10]

def main():
    df = pd.read_csv(RAW)
    df = df.replace("Select", np.nan)                                # EDA: 'Select' = skipped question
    df["Lead Source"] = df["Lead Source"].replace({"google": "Google"})  # EDA: duplicate spelling

    out = df[list(MAPPING)].rename(columns=MAPPING)

    rng = np.random.default_rng(42)            # fixed seed = same split every run
    out.insert(0, "contact_id", df["Prospect ID"].map(anon_id))
    out.insert(1, "tenant", rng.choice(TENANTS, size=len(out)))
    out["dnd_email"] = out["dnd_email"].eq("Yes")
    out["dnd_call"] = out["dnd_call"].eq("Yes")
    out["tags"] = out["tags"].apply(lambda t: [] if pd.isna(t) else [t])
    out["opportunity_status"] = np.where(out["converted"] == 1, "won", "lost")

    # The dataset has no dates. Synthetic dates are needed later for the trend
    # chart and alerts, and are flagged so they are never presented as real.
    days = rng.integers(0, 90, size=len(out))
    out["date_added"] = pd.Timestamp("2026-07-01") + pd.to_timedelta(days, unit="D")
    out["date_is_synthetic"] = True

    out.to_json(OUT, orient="records", lines=True, date_format="iso")
    print("Saved", len(out), "leads to", OUT)
    print(out.groupby("tenant").size())

if __name__ == "__main__":
    main()