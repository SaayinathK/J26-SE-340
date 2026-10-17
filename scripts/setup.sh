#!/usr/bin/env sh
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
node scripts/setup.cjs
npm ci --prefix frontend
npm ci --prefix services/gateway
npm ci --prefix services/email-agent
printf '%s\n' 'Next: docker compose build; docker compose up -d gateway-database email-agent-database content-agent-database lead-intel-database strategy-fl-database; ./scripts/migrate-all.sh; docker compose up -d'
