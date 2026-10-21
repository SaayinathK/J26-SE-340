# C3-ADR-001 — Calibrated Gradient Boosting for lead scoring, sales fields excluded

**Date:** 8 Oct 2026 · **Status:** Accepted · **Owner:** Shathursini J (C3)

## Context
FR2/FR3 need a 0–100 conversion score and hot/warm/cold segments. O2 requires beating a rule-based
baseline (target AUC ≥ 0.80). The X Education data has sales-team fields (Tags, Lead Quality, Lead Profile,
Last Notable Activity) that are filled in after contact.

## Decision
- Compare Gradient Boosting, Random Forest and Logistic Regression with 5-fold CV; keep the best (GB).
- **Exclude the sales-team fields** (leakage): with them AUC is 0.98, which a new lead could never reach.
- **Isotonic calibration** so a score of 80 means about 80% of such leads convert; thresholds 40 / 70.
- SHAP TreeExplainer for the top 3 factors per lead (FR9 explainability).

## Consequences
- Test AUC 0.891 vs rule baseline 0.786; segments convert at 85% / 59% / 13% (`reports/c3-04_*`, `c3-05_*`).
- One model for all tenants (v1). Per-tenant models are possible later if a tenant's data drifts (FR7 monitoring).
