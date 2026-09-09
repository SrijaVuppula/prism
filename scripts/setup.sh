#!/usr/bin/env bash
# One-command local bootstrap.
set -e

echo "Installing dependencies..."
npm install

echo "Starting local Postgres (pgvector)..."
docker compose -f infra/docker-compose.yml up -d postgres

echo "Done. Run 'npm run dev:backend' and 'npm run dev:web' in separate terminals."
