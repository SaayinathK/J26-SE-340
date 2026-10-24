#!/bin/sh
# scripts/migrate-all.sh - apply every service's db/migrations/*.sql to its OWN database (database per service).
# New databases run their migrations automatically when the container is first created; this script brings an
# EXISTING database up to date. Every migration is written to be safe to run again (IF NOT EXISTS ...).
# Run from the repository root (Git Bash on Windows):   sh scripts/migrate-all.sh
set -e
cd "$(dirname "$0")/.."

# service folder | compose database service | admin user | database name
MAP="lead-intel|lead-intel-database|c3_admin|lead_intel"
# C4 (gateway): its migrations are in db/migrations and run on first start of the `db` container.
# Add a line here when they move to services/gateway/db/migrations and are safe to repeat.

echo "$MAP" | while IFS='|' read -r service container user database; do
  [ -z "$service" ] && continue
  for f in services/"$service"/db/migrations/*.sql; do
    [ -f "$f" ] || continue
    echo "== $service: $(basename "$f")"
    docker compose exec -T "$container" psql -v ON_ERROR_STOP=1 -q -U "$user" -d "$database" < "$f"
  done
done
echo "All migrations applied."
