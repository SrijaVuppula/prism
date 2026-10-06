#!/usr/bin/env bash
# One-command local bootstrap: dependencies, packages/prism-backend/.env,
# and a migrated Postgres. Safe to re-run.
set -e

echo "Installing dependencies..."
npm install

echo "Preparing packages/prism-backend/.env (existing values are kept)..."
npm run init-env

echo "Starting Postgres (pgvector) and applying migrations..."
npm run db:up

echo "Done. Run 'npm run dev' to start the backend and companion app, then 'npm run seed' in another terminal."
