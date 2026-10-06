# Built from the repository root (see infra/docker-compose.yml), not this
# directory, so the prism-alert-engine workspace dependency resolves.
FROM node:22-slim
WORKDIR /app

# The companion app's manifest is copied only so the lockfile matches the
# workspace layout; its dependencies aren't installed.
COPY package.json package-lock.json ./
COPY apps/prism-companion-web/package.json apps/prism-companion-web/
COPY packages/prism-alert-engine packages/prism-alert-engine
COPY packages/prism-backend packages/prism-backend

# Installing also compiles prism-alert-engine (its prepare script).
RUN npm ci --workspace=prism-alert-engine --workspace=prism-backend
RUN npm run build --workspace=prism-backend

WORKDIR /app/packages/prism-backend
EXPOSE 3000
# Brings the schema up to date before serving; a no-op when it already is.
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/server.js"]
