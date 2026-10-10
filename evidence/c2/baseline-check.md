# C2 baseline verification

Actual execution date: 25 October 2026 (Asia/Colombo).
This result was obtained before importing the existing source tree into Git.

Command (Hugging Face and Transformers offline):

```text
python -m pytest strategy_agent/tests/test_auth_and_config.py strategy_agent/tests/test_tenant_isolation.py strategy_agent/tests/test_generation.py strategy_agent/tests/test_learning.py strategy_agent/tests/test_privacy.py strategy_agent/tests/test_api_consent.py
```

Result: **102 passed, 2 failed in 55.92 seconds**.

Failures:

1. `test_no_identifying_data_survives_in_the_shared_store`: expected a positive published-contribution count; observed zero.
2. `test_narrowing_scopes_purges_what_was_shared_under_the_broader_consent`: expected zero contributions after scope narrowing; observed four.

No application source code was changed to obtain a different result.
The supplied historical evaluation reports are separate artifacts and do not supersede this current baseline.
GPU inference/training and federated deployments were not executed as part of this Git-history import.
