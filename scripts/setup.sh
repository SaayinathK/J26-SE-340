#!/bin/sh
# scripts/setup.sh - first start on a new computer (Git Bash on Windows, or any shell on Linux / macOS).
# Windows PowerShell alternative: scripts/start-docker.ps1 (same steps + smoke test).
set -e
cd "$(dirname "$0")/.."

# 1. the files that are not in git (see ml/lead-intel/README.md for how to get or rebuild them)
for f in ml/models/lead-intel/lead_scorer.joblib ml/lead-intel/data/processed/leads_ghl.jsonl \
         ml/lead-intel/data/processed/kb/tenant_a_vectors.npy; do
  [ -f "$f" ] || { echo "Missing: $f  - see ml/lead-intel/README.md"; exit 1; }
done

# 2. a private .env with a random JWT secret (never committed)
if [ ! -f .env ]; then
  cp .env.example .env
  secret=$(head -c 48 /dev/urandom | base64 | tr -d '\n/+=')
  sed -i.bak "s#^JWT_SECRET=.*#JWT_SECRET=$secret#" .env && rm -f .env.bak
  echo "Created .env with a new JWT_SECRET"
fi

# 3. build and start, bring databases up to date, add demo data
docker compose up -d --build --wait db lead-intel-database lead-intel gateway frontend
sh scripts/migrate-all.sh
sh scripts/seed-all.sh
docker compose up -d lead-intel-model ollama
echo "Ready: http://localhost:3000"
