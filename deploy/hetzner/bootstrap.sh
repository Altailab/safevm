#!/usr/bin/env bash
# Runs ON the Hetzner server (pushed there by provision.ts). Brings up the full
# SafeVM stack with the Firecracker runtime. Idempotent-ish; safe to re-run.
set -euo pipefail
REPO=/opt/safevm
cd "$REPO"

echo "==> Base packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl git ca-certificates iproute2 iptables e2fsprogs netcat-openbsd \
  docker.io docker-compose-plugin unzip
systemctl enable --now docker

echo "==> Bun"
if ! command -v bun >/dev/null 2>&1; then
  curl -fsSL https://bun.sh/install | bash
  ln -sf "$HOME/.bun/bin/bun" /usr/local/bin/bun
fi
bun --version

echo "==> Firecracker host setup + images"
bash deploy/firecracker/setup-host.sh
bash deploy/firecracker/fetch-images.sh

echo "==> App deps + env"
[ -f .env ] || cp deploy/.env.example .env
bun install

echo "==> Backing services (Postgres/Redis/RabbitMQ)"
docker compose -f deploy/docker-compose.yml up -d
echo "   waiting for Postgres..."
for i in $(seq 1 30); do docker exec safevm-cloud-postgres-1 pg_isready -U safevm >/dev/null 2>&1 && break; sleep 2; done
echo "   waiting for RabbitMQ..."
for i in $(seq 1 30); do nc -z localhost 5672 && break; sleep 2; done

echo "==> Migrate + seed"
bun run --cwd packages/control-plane db:generate
DATABASE_URL="postgres://safevm:safevm@localhost:5433/safevm" bun run --cwd packages/control-plane db:deploy
DATABASE_URL="postgres://safevm:safevm@localhost:5433/safevm" bun run --cwd packages/control-plane db:seed

echo "==> systemd services"
cat >/etc/systemd/system/safevm-cp.service <<EOF
[Unit]
Description=SafeVM control plane
After=docker.service
[Service]
WorkingDirectory=$REPO
EnvironmentFile=$REPO/.env
ExecStart=/usr/local/bin/bun run packages/control-plane/src/index.ts
Restart=always
[Install]
WantedBy=multi-user.target
EOF

cat >/etc/systemd/system/safevm-agent.service <<EOF
[Unit]
Description=SafeVM node agent (firecracker)
After=docker.service
[Service]
WorkingDirectory=$REPO
EnvironmentFile=$REPO/.env
Environment=RUNTIME=firecracker
ExecStart=/usr/local/bin/bun run packages/node-agent/src/index.ts
Restart=always
[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now safevm-cp.service safevm-agent.service
sleep 3
systemctl --no-pager --lines=10 status safevm-cp.service || true
systemctl --no-pager --lines=10 status safevm-agent.service || true

echo "==> Done. Control plane on :3001, RabbitMQ mgmt on :15672"
