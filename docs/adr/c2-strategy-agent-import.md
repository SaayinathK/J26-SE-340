# C2 implementation choices observed during import

Recorded on 25 October 2026 from the supplied code; this is not a historical meeting record.

- The supplied component is `strategy_agent`, separate from the referenced `fl_marketing` project.
- FastAPI serves the API and the single-page UI from one application.
- JWT tenant context or development headers scope all tenant repository access.
- SQLite tenant records and anonymised shared insights use separate stores.
- A deterministic template is the fallback for optional local language-model generation.
- The supplied language-model training uses QLoRA SFT and optional DPO, rather than FedAvg.
- Consent, anonymisation, k-anonymity and optional Laplace noise govern shared insights.
- Cumulative DP accounting, federated client aggregation and secure aggregation are not implemented here.

Source: `strategy_agent/config.py`, `auth.py`, `db/`, `generation/`, `privacy/`, `training/` and `HANDOVER.md`.
The worksheet task about team decisions is recorded separately; team approval is not inferred.
