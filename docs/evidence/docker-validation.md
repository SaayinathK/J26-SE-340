# Docker validation, 20–21 October 2026

Run on the development laptop (Windows, Docker Desktop 4.96.0, Linux containers; Docker VM memory 6.7 GB).

## Results

| Check | Result |
| --- | --- |
| Build of all images (`docker compose up --build`) | lead-intel, gateway and dashboard built; first build 76 min (Python packages), cached afterwards |
| Containers | db, lead-intel, gateway, dashboard all healthy (`docker compose ps`) |
| `scripts/smoke-docker.ps1` | 5/5 PASS: JWT tenant isolation and spoofed `X-Tenant-Id` rejected; gateway → lead-intel for analytics, dashboard, monitoring; login, scoring, dashboard health |
| C3 tests inside the lead-intel container | 34 passed (Python 3.13, Linux) |
| Gateway tests inside the gateway container | 32 passed in 3 suites (isolation, leads proxy, email KB transaction) |
| Real recommendation through the gateway (tenant_a, top lead) | 91 s; grounded = true; policy_check = consistent; llm_model = c3-mistral-ft; retrieval = hybrid |

## Finding: the LLM needs more memory than the Docker VM has

With Mistral 7B in the Ollama **container**, the model alone used 4.8 GB of the 6.7 GB Docker VM (71%), and a
recommendation did not finish within the gateway's 300 s timeout (HTTP 502).

Fix for laptops: C3 can call Ollama on the **host** instead. In the root `.env` (not in git):

    C3_OLLAMA_URL=http://host.docker.internal:11434

then `docker compose stop ollama`. The host Ollama needs `c3-mistral-ft` and `nomic-embed-text`
(see `services/lead-intel/Modelfile`). With this setting the recommendation took 91 s.
The team default in `docker-compose.yml` is still the Ollama container. In production the LLM would run on a
GPU server.

## Not verified

- Real email generation through the gateway: the email isolation tests used the `[MOCK]` fallback because
  Ollama did not answer in time (C4).
- Load or concurrency testing of the Docker stack.