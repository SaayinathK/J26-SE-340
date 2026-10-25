#!/bin/sh
# scripts/seed-all.sh - optional demo data for every service (run AFTER docker compose up and migrate-all.sh).
# Run from the repository root (Git Bash on Windows):   sh scripts/seed-all.sh
set -e
cd "$(dirname "$0")/.."

# C4 gateway: demo users of the three tenants (password in services/gateway/scripts/seed-users.js)
docker compose run --rm --no-deps gateway node scripts/seed-users.js

# C3 lead intelligence: a first REAL score for the top 5 hot / warm / cold leads of each tenant,
# so the Lead history page is not empty (source = 'seed'; nothing is invented)
for tenant in tenant_a tenant_b tenant_c; do
  docker compose exec -T lead-intel python db/seed/seed_history.py "$tenant" 5
done
echo "Seed data added."
