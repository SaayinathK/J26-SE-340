# C3-01 Field mapping – Kaggle X Education → GHL-style lead schema

| Kaggle column | GHL-style field | Used as | Note |
|---|---|---|---|
| Prospect ID | contact_id | ID | Hashed to L-xxxxxxxxxx (anonymised) |
| Lead Number | (dropped) | – | Near-unique number with no meaning |
| Lead Source | source | Model feature | "google" merged into "Google" |
| Lead Origin | lead_origin | Model feature | Landing Page Submission, API, Lead Add Form … |
| Do Not Email / Do Not Call | dnd_email / dnd_call | Record + rule baseline | Yes/No → true/false |
| TotalVisits | total_visits | Model feature | Outliers (max 251) → log transform later |
| Total Time Spent on Website | time_on_site_sec | Model feature | Seconds |
| Page Views Per Visit | pages_per_visit | Model feature | |
| Last Activity | last_activity | Model feature | Email Opened, SMS Sent … |
| Last Notable Activity | last_notable_activity | Leakage check only | Recorded by sales process |
| What is your current occupation | occupation | Model feature | Custom field |
| Specialization | specialization | Model feature | "Select" → missing |
| Country / City | country / city | Record only | "Select" → missing (City) |
| Tags | tags[ ] | Leakage check + objection proxy | Sales field; leaks outcome (EDA) |
| Lead Quality / Lead Profile | lead_quality / lead_profile | Leakage check only | Assigned by sales staff |
| Converted | converted + opportunity_status | Label | 1 → won, 0 → lost |
| (not in dataset) | tenant | Multi-tenant split | Seeded random split: tenant_a / b / c |
| (not in dataset) | date_added | Trend + alerts | SYNTHETIC, flagged date_is_synthetic = true |

Not mapped: How did you hear about X Education (54.6% "Select"), the four Asymmetrique columns (45.6% missing, company-assigned), and the course-preference / magazine / newspaper yes-no columns.