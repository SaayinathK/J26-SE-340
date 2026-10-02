# API contracts

Component OpenAPI JSON files describe the implemented endpoint surface and explicit pending states. The frontend calls same-origin /api through gateway. Agents are internal JSON APIs; model endpoints are not browser APIs. Gateway owns account cookies/CSRF. Email Agent accepts short-lived signed gateway identity and also retains its legacy service auth endpoints.
