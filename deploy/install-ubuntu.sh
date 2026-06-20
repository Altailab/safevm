#!/usr/bin/env bash
# ============================================================================
# SafeVM — single-box installer for Ubuntu Server (22.04 / 24.04)
# ----------------------------------------------------------------------------
# Installs everything needed to run a SafeVM pilot on one machine:
#   - Docker engine + compose (backing services: Postgres, Redis, RabbitMQ)
#   - Bun runtime
#   - App services (control-plane, node-agent, agent) as systemd units
#   - The React dashboard, built and served by nginx (which also reverse-proxies
#     the API, so the browser talks to one origin — no CORS, no exposed :3001)
#
# Two ways to run, both as root:
#
#   A) From a checked-out repo:
#        sudo PUBLIC_ADDR=desktops.example.com bash deploy/install-ubuntu.sh
#
#   B) Straight from a URL (self-clones the repo first):
#        curl -fsSL https://raw.githubusercontent.com/Altailab/safevm/main/deploy/install-ubuntu.sh \
#          | sudo PUBLIC_ADDR=desktops.example.com bash
#
# Knobs (env vars, all optional):
#   PUBLIC_ADDR          domain or public IP the browser will use (auto-detected if unset)
#   HTTP_PORT            plain-HTTP port nginx listens on             (default 80)
#   TLS_EMAIL            if set (with a real domain + DNS), get a Let's Encrypt cert
#                          via certbot and serve HTTPS on 443
#   SEED_ADMIN_EMAIL     first admin login                           (default admin@safevm.local)
#   SEED_ADMIN_PASSWORD  first admin password         (default: generated, printed at the end)
#   RUNTIME              docker | mock | firecracker  (default docker = real desktops)
#   WEBTOP_IMAGE         desktop container image      (default lscr.io/linuxserver/webtop:ubuntu-xfce)
#   APP_USER             unix user to own/run the app (default: the invoking sudo user)
#   SAFEVM_REPO          git URL to clone when run from a URL
#                          (default https://github.com/Altailab/safevm.git)
#   SAFEVM_REF           branch/tag to install         (default main)
#   INSTALL_DIR          where to clone in mode B      (default /opt/safevm)
#
# Idempotent-ish: safe to re-run to upgrade an existing install.
# ============================================================================
set -euo pipefail

# --- preflight -------------------------------------------------------------
[[ $EUID -eq 0 ]] || { echo "Run as root (sudo)." >&2; exit 1; }

APP_USER="${APP_USER:-${SUDO_USER:-root}}"
INSTALL_DIR="${INSTALL_DIR:-/opt/safevm}"
SAFEVM_REPO="${SAFEVM_REPO:-https://github.com/Altailab/safevm.git}"
SAFEVM_REF="${SAFEVM_REF:-main}"

# --- bootstrap: find the repo, or clone it if we were piped from a URL ------
is_safevm_repo() { [[ -f "$1/package.json" ]] && grep -q '"name": "safevm"' "$1/package.json" 2>/dev/null; }

REPO_DIR=""
# $BASH_SOURCE points at a real path only when run as a file (mode A), not when piped.
if [[ -f "${BASH_SOURCE[0]:-}" ]]; then
  cand="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  is_safevm_repo "$cand" && REPO_DIR="$cand"
fi
if [[ -z "$REPO_DIR" ]]; then
  echo "==> Not inside a repo — cloning (mode B)"
  command -v git >/dev/null 2>&1 || { apt-get update -y && apt-get install -y git; }
  if [[ -d "$INSTALL_DIR/.git" ]]; then
    git -C "$INSTALL_DIR" fetch --depth 1 origin "$SAFEVM_REF"
    git -C "$INSTALL_DIR" checkout -f FETCH_HEAD
  else
    git clone --depth 1 --branch "$SAFEVM_REF" "$SAFEVM_REPO" "$INSTALL_DIR"
  fi
  REPO_DIR="$INSTALL_DIR"
  chown -R "$APP_USER" "$REPO_DIR"
  # We were piped from a URL (stdin = the script). Re-exec from the on-disk file
  # with stdin detached, so commands that read stdin (e.g. `docker compose exec`)
  # can't drain the script and cut the run short.
  echo "==> Re-launching from $REPO_DIR (detached stdin)"
  exec </dev/null bash "$REPO_DIR/deploy/install-ubuntu.sh"
fi
cd "$REPO_DIR"
chown -R "$APP_USER" "$REPO_DIR"
RUNTIME="${RUNTIME:-docker}"
SEED_ADMIN_EMAIL="${SEED_ADMIN_EMAIL:-admin@safevm.local}"
SEED_ADMIN_PASSWORD="${SEED_ADMIN_PASSWORD:-$(openssl rand -base64 12)}"
JWT_SECRET="$(openssl rand -hex 32)"

# Where the browser reaches this box. Auto-detect a public IP if not given.
if [[ -z "${PUBLIC_ADDR:-}" ]]; then
  PUBLIC_ADDR="$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)"
  PUBLIC_ADDR="${PUBLIC_ADDR:-$(hostname -I | awk '{print $1}')}"
fi

# Guard: don't let the literal example placeholder through — it produces an
# unreachable install.
if [[ "$PUBLIC_ADDR" == *example.com* ]]; then
  echo "ERROR: PUBLIC_ADDR is still the placeholder '$PUBLIC_ADDR'." >&2
  echo "       Set it to this server's public IP or a real domain pointing here." >&2
  exit 1
fi

# Is PUBLIC_ADDR a bare IP? Let's Encrypt cannot issue certs for IPs, only domains.
is_ip() { [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || [[ "$1" == *:*:* ]]; }
if [[ -n "${TLS_EMAIL:-}" ]] && is_ip "$PUBLIC_ADDR"; then
  echo "WARNING: TLS_EMAIL is set but PUBLIC_ADDR ($PUBLIC_ADDR) is an IP." >&2
  echo "         Let's Encrypt can't issue certs for IPs — skipping TLS, serving plain HTTP." >&2
  echo "         Use a domain pointing at this box if you want HTTPS." >&2
  TLS_EMAIL=""
fi

# HTTP_PORT is the plain-HTTP port nginx listens on (default 80). With TLS_EMAIL,
# certbot adds the 443 listener and redirects this port to it.
HTTP_PORT="${HTTP_PORT:-80}"
SCHEME="http"; URL_PORT=":$HTTP_PORT"; [[ "$HTTP_PORT" == "80" ]] && URL_PORT=""
[[ -n "${TLS_EMAIL:-}" ]] && { SCHEME="https"; URL_PORT=""; }
PUBLIC_URL="$SCHEME://$PUBLIC_ADDR$URL_PORT"

echo "==> SafeVM install"
echo "    repo:        $REPO_DIR"
echo "    app user:    $APP_USER"
echo "    runtime:     $RUNTIME"
echo "    http port:   $HTTP_PORT"
echo "    public URL:  $PUBLIC_URL"
echo

# --- 1. system packages ----------------------------------------------------
echo "==> Installing base packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
# nodejs: Bun runs the app, but `prisma generate` hangs under Bun (its codegen
# child-process IPC stalls), so the Prisma CLI steps run under Node instead.
apt-get install -y ca-certificates curl git unzip openssl nginx gnupg lsb-release nodejs

# --- 2. docker -------------------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  echo "==> Installing Docker"
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker
[[ "$APP_USER" != "root" ]] && usermod -aG docker "$APP_USER" || true

# --- 3. bun (system-wide at /opt/bun) --------------------------------------
BUN_DIR=/opt/bun
BUN=/opt/bun/bin/bun
if [[ ! -x "$BUN" ]]; then
  echo "==> Installing Bun"
  curl -fsSL https://bun.sh/install | BUN_INSTALL="$BUN_DIR" bash
fi
ln -sf "$BUN" /usr/local/bin/bun

# --- 4. environment files --------------------------------------------------
echo "==> Writing .env"
cat > "$REPO_DIR/.env" <<ENV
DATABASE_URL=postgres://safevm:safevm@localhost:5433/safevm
REDIS_URL=redis://localhost:6379
RABBITMQ_URL=amqp://safevm:safevm@localhost:5672

JWT_SECRET=$JWT_SECRET
TENANT_ID=default
WEB_ORIGIN=$PUBLIC_URL
PORT=3001

# node-agent
RUNTIME=$RUNTIME
NODE_ID=node-1
WEBTOP_IMAGE=${WEBTOP_IMAGE:-lscr.io/linuxserver/webtop:ubuntu-xfce}
# Desktop containers are published so the remote browser can reach them, and
# tagged with the public host so connectUrl is browser-reachable (not localhost).
DOCKER_BIND_ADDR=0.0.0.0
DOCKER_HOST_ADDR=$PUBLIC_ADDR
ENV
chown "$APP_USER" "$REPO_DIR/.env"

# The dashboard talks to the API at the same origin (nginx proxies /api + /health).
echo "VITE_API_URL=$PUBLIC_URL" > "$REPO_DIR/packages/web/.env"
chown "$APP_USER" "$REPO_DIR/packages/web/.env"

# --- 5. backing services (Postgres / Redis / RabbitMQ) ---------------------
echo "==> Starting backing services (docker compose)"
docker compose -f "$REPO_DIR/deploy/docker-compose.yml" up -d

echo "==> Waiting for Postgres"
for i in $(seq 1 60); do
  docker compose -f "$REPO_DIR/deploy/docker-compose.yml" exec -T postgres pg_isready -U safevm </dev/null >/dev/null 2>&1 && break
  sleep 2
done

# --- 6. install deps, migrate, seed, build ---------------------------------
echo "==> bun install"
sudo -u "$APP_USER" --preserve-env=PATH bash -lc "cd '$REPO_DIR' && '$BUN' install"

echo "==> Prisma generate + migrate (Node) + seed (Bun)"
run_app() { sudo -u "$APP_USER" bash -lc "cd '$REPO_DIR/packages/control-plane' && set -a && . '$REPO_DIR/.env' && set +a && $1"; }
# generate + migrate run via the local Prisma CLI under NODE (the .bin shim has a
# `#!/usr/bin/env node` shebang) — `bun run prisma generate` hangs after the
# generator handshake.
run_app "./node_modules/.bin/prisma generate"
run_app "./node_modules/.bin/prisma migrate deploy"
# seed must run under Bun (it uses Bun.password to hash the admin password).
SEED_ADMIN_EMAIL="$SEED_ADMIN_EMAIL" SEED_ADMIN_PASSWORD="$SEED_ADMIN_PASSWORD" \
  sudo -u "$APP_USER" bash -lc "cd '$REPO_DIR/packages/control-plane' && set -a && . '$REPO_DIR/.env' && set +a && SEED_ADMIN_EMAIL='$SEED_ADMIN_EMAIL' SEED_ADMIN_PASSWORD='$SEED_ADMIN_PASSWORD' '$BUN' run prisma/seed.ts"

echo "==> Building the dashboard"
sudo -u "$APP_USER" bash -lc "cd '$REPO_DIR/packages/web' && '$BUN' run build"

# Pre-pull the desktop image so the first Connect is fast (docker runtime only).
if [[ "$RUNTIME" == "docker" ]]; then
  echo "==> Pulling desktop image (webtop)"
  docker pull "${WEBTOP_IMAGE:-lscr.io/linuxserver/webtop:ubuntu-xfce}" || \
    echo "    (pull failed — it'll pull on first connect)"
fi

# --- 7. systemd units for the app services ---------------------------------
echo "==> Installing systemd services"
mk_unit() { # name, workdir, description
  cat > "/etc/systemd/system/safevm-$1.service" <<UNIT
[Unit]
Description=SafeVM $3
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$REPO_DIR/$2
EnvironmentFile=$REPO_DIR/.env
ExecStart=$BUN run src/index.ts
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT
}
mk_unit control-plane packages/control-plane "control plane API"
mk_unit node-agent    packages/node-agent    "node agent (session runtime)"
mk_unit agent         packages/agent         "AI agent runner"

systemctl daemon-reload
systemctl enable --now safevm-control-plane safevm-node-agent safevm-agent

# --- 8. nginx: serve dashboard + proxy the API -----------------------------
echo "==> Configuring nginx"
cat > /etc/nginx/sites-available/safevm <<NGINX
server {
    listen $HTTP_PORT;
    server_name $PUBLIC_ADDR;

    root $REPO_DIR/packages/web/dist;
    index index.html;

    # SPA: serve files, fall back to index.html for client-side routes.
    location / {
        try_files \$uri \$uri/ /index.html;
    }

    # API + health → control plane (same origin, so no CORS in the browser).
    location ~ ^/(api|health) {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        # WebRTC/WebSocket signalling (Selkies tier) rides through here too.
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
NGINX
ln -sf /etc/nginx/sites-available/safevm /etc/nginx/sites-enabled/safevm
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

# --- 9. optional TLS via certbot -------------------------------------------
if [[ -n "${TLS_EMAIL:-}" ]]; then
  echo "==> Obtaining TLS certificate for $PUBLIC_ADDR"
  apt-get install -y certbot python3-certbot-nginx
  certbot --nginx -d "$PUBLIC_ADDR" --non-interactive --agree-tos -m "$TLS_EMAIL" --redirect || \
    echo "    (certbot failed — ensure $PUBLIC_ADDR's DNS points here, then re-run certbot)"
fi

# --- done ------------------------------------------------------------------
cat <<DONE

============================================================================
SafeVM is up.

  Dashboard:  $PUBLIC_URL
  Login:      $SEED_ADMIN_EMAIL
  Password:   $SEED_ADMIN_PASSWORD

Services (systemctl status safevm-control-plane | safevm-node-agent | safevm-agent)
Logs:       journalctl -u safevm-control-plane -f
Backing:    docker compose -f deploy/docker-compose.yml ps

Next steps:
  - Lock down the firewall: allow 80/443 (and 22), block 5433/6379/5672/15672
    from the internet (ufw allow 80,443,22; ufw enable).
  - Desktop containers publish on $PUBLIC_ADDR:<random port>. For the docker
    tier the in-app viewer connects there directly; put these behind the proxy
    + TLS before any real use.
============================================================================
DONE
