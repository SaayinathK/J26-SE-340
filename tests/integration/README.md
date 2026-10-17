# Cross-service integration

The executable browser/API runner is ../e2e/verify-service-flow.cjs. It exercises frontend -> gateway -> Email Agent against two isolated PostgreSQL databases, checks persistence and tenant isolation, rejects forged identity, and tests outage recovery. Component account/SQL tests remain in services/<service>/tests/integration. Add HTTP-only cross-service suites here when those contracts expand.
