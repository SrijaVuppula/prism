#!/usr/bin/env bash
# Installs or updates the Prism demo on an Ubuntu 24.04 server: Node.js 22,
# Docker with Postgres (pgvector), the built backend and companion app, and
# a systemd service that runs them on port 3000. Run as root, from a
# checkout at /opt/prism. The CloudFormation template (prism-demo.yaml)
# runs it on first boot, after writing the backend's settings to
# /etc/prism.env. It's safe to re-run after pulling new commits:
#
#   sudo -u prism git -C /opt/prism pull --ff-only
#   sudo bash /opt/prism/infra/aws/demo/deploy.sh
#
# The first run also sets the household's preferences (PRISM_TIME_ZONE,
# default America/Los_Angeles) and sends the simulated events from
# `npm run seed`, so the app has alerts to show from the start.
set -euo pipefail

APP_DIR=/opt/prism
APP_USER=prism
STATE_DIR=/var/lib/prism
TIME_ZONE="${PRISM_TIME_ZONE:-America/Los_Angeles}"
COMPOSE=(docker compose -f "$APP_DIR/infra/docker-compose.yml")

log() { echo "[deploy] $*"; }

# Runs a command as the app user, from the checkout.
as_app() { (cd "$APP_DIR" && runuser -u "$APP_USER" -- env HOME="/home/$APP_USER" "$@"); }

if [[ $EUID -ne 0 ]]; then
  echo "Run as root: sudo bash $0" >&2
  exit 1
fi

log "installing system packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q ca-certificates curl git docker.io docker-compose-v2

node_major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
if (( node_major < 22 )); then
  log "installing Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource_setup.sh
  bash /tmp/nodesource_setup.sh
  apt-get install -y -q nodejs
fi

# Room for npm and the builds on a 2 GB instance.
if [[ ! -f /swapfile ]]; then
  log "adding 2 GB of swap"
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo "/swapfile none swap sw 0 0" >> /etc/fstab
fi

if ! id -u "$APP_USER" >/dev/null 2>&1; then
  useradd --system --create-home --shell /usr/sbin/nologin "$APP_USER"
fi
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

log "starting Postgres"
systemctl enable --now docker
"${COMPOSE[@]}" up -d --wait postgres
docker update --restart unless-stopped "$("${COMPOSE[@]}" ps -q postgres)" >/dev/null

log "installing dependencies and building"
as_app npm ci --no-audit --no-fund
# Creates packages/prism-backend/.env with a generated webhook secret and
# VAPID key pair on the first run, and keeps existing values after that.
as_app npm run init-env
as_app npm run migrate
as_app env VITE_DEMO_NOTE=1 npm run build

log "installing the prism service"
cat > /etc/systemd/system/prism.service <<UNIT
[Unit]
Description=Prism backend and companion app
After=network-online.target docker.service
Wants=network-online.target
Requires=docker.service

[Service]
User=$APP_USER
WorkingDirectory=$APP_DIR/packages/prism-backend
EnvironmentFile=/etc/prism.env
ExecStart=/usr/bin/node dist/server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable prism
systemctl restart prism

log "waiting for the backend"
for _ in $(seq 60); do
  if curl -fsS http://localhost:3000/health >/dev/null 2>&1; then break; fi
  sleep 2
done
if ! curl -fsS http://localhost:3000/health >/dev/null; then
  journalctl -u prism -n 30 --no-pager
  echo "The backend didn't start." >&2
  exit 1
fi

alert_count() {
  curl -fsS "http://localhost:3000/alerts?limit=50" | node -e '
    let body = "";
    process.stdin.on("data", (chunk) => (body += chunk)).on("end", () => console.log(JSON.parse(body).alerts.length));
  '
}

if [[ ! -f "$STATE_DIR/seeded" ]]; then
  log "setting the household's preferences (time zone $TIME_ZONE)"
  curl -fsS -X PUT http://localhost:3000/preferences \
    -H "Content-Type: application/json" \
    -d "{\"timeZone\":\"$TIME_ZONE\",\"hapticOverrides\":{},\"quietHours\":{\"enabled\":true,\"startHour\":22,\"endHour\":7},\"knownVisitorTaggingEnabled\":false}" \
    >/dev/null

  log "sending the simulated events"
  seed_started=$(date "+%Y-%m-%d %H:%M:%S")
  as_app env SIMULATOR_DELAY_MS=5000 npm run seed

  for _ in $(seq 45); do
    if (( $(alert_count) > 0 )); then break; fi
    sleep 2
  done
  # A Ring event whose snapshot can't be classified still alerts, from its
  # event type, so the log is what shows whether Amazon Bedrock answered.
  if (( $(alert_count) == 0 )) ||
    journalctl -u prism --since "$seed_started" --no-pager | grep -qE "AccessDenied|classification failed|lookup failed"; then
    journalctl -u prism --since "$seed_started" --no-pager | tail -n 30
    echo "The simulated events weren't classified. Check that the account can call Claude Haiku 4.5 and Titan Text Embeddings V2 on Amazon Bedrock in us-east-2 (see infra/aws/README.md)." >&2
    exit 1
  fi
  mkdir -p "$STATE_DIR"
  touch "$STATE_DIR/seeded"
fi

log "done: $(alert_count) alerts stored, serving on port 3000"
