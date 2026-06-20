#!/usr/bin/env bash
# ============================================================================
# SafeVM — uninstaller for Ubuntu Server. Reverses install-ubuntu.sh.
# ----------------------------------------------------------------------------
# Removes (by default):
#   - the systemd services (control-plane, node-agent, agent) + unit files
#   - all running desktop session containers + the safevm-desktops network
#   - the backing services (Postgres/Redis/RabbitMQ containers + network)
#   - the nginx site config (restores the default site)
#   - the Bun install (/opt/bun + the bun symlink + the .bashrc PATH line)
#   - the cloned repo (/opt/safevm)
#
# Run as root:
#   sudo bash deploy/uninstall-ubuntu.sh         # keeps data volumes + Docker
#
# Flags (env vars):
#   PURGE_DATA=1     also delete the Postgres/Redis/RabbitMQ data volumes and
#                    the pulled desktop image (DESTROYS all workspace data)
#   KEEP_REPO=1      leave the cloned repo in place
#   REMOVE_DOCKER=1  also apt-purge Docker Engine + its apt repo/key
#   REMOVE_NGINX=1   also apt-purge nginx
#   REMOVE_NODE=1    also apt-purge Node.js (installed for the Prisma CLI)
#   INSTALL_DIR=...  repo location (default /opt/safevm)
#   APP_USER=...     user whose .bashrc the Bun PATH line is removed from
# ============================================================================
set -uo pipefail   # NOT -e: best-effort teardown, keep going if a step is already gone

[[ $EUID -eq 0 ]] || { echo "Run as root (sudo)." >&2; exit 1; }

INSTALL_DIR="${INSTALL_DIR:-/opt/safevm}"
APP_USER="${APP_USER:-${SUDO_USER:-root}}"
COMPOSE_FILE="$INSTALL_DIR/deploy/docker-compose.yml"
PROJECT="safevm-cloud"

# --- interactive prompts (when run directly on a terminal) ------------------
# Skipped if the value is preset, there's no TTY, or SAFEVM_NONINTERACTIVE=1.
have_tty() { [[ -e /dev/tty ]]; }
yesno() { # yesno VAR "prompt" — sets VAR=1 on yes; respects a preset value
  local var="$1" prompt="$2" ans
  [[ -n "${!var:-}" ]] && return
  { have_tty && [[ "${SAFEVM_NONINTERACTIVE:-0}" != "1" ]]; } || return
  read -r -p "$prompt [y/N]: " ans </dev/tty || true
  [[ "$ans" =~ ^[Yy] ]] && printf -v "$var" '%s' "1"
}
if have_tty && [[ "${SAFEVM_NONINTERACTIVE:-0}" != "1" ]]; then
  yesno PURGE_DATA   "Also DELETE all data (Postgres/Redis/RabbitMQ volumes)?"
  yesno REMOVE_DOCKER "Also remove Docker Engine?"
  yesno REMOVE_NODE   "Also remove Node.js?"
fi
# Safety confirmation (skip with ASSUME_YES=1 or when non-interactive).
if [[ "${ASSUME_YES:-0}" != "1" ]] && have_tty && [[ "${SAFEVM_NONINTERACTIVE:-0}" != "1" ]]; then
  read -r -p "Remove SafeVM from this box? type 'yes': " __ok </dev/tty || true
  [[ "$__ok" == "yes" ]] || { echo "Aborted."; exit 0; }
fi

echo "==> SafeVM uninstall (PURGE_DATA=${PURGE_DATA:-0} REMOVE_DOCKER=${REMOVE_DOCKER:-0} REMOVE_NGINX=${REMOVE_NGINX:-0} REMOVE_NODE=${REMOVE_NODE:-0})"

# --- 1. app systemd services ----------------------------------------------
echo "==> Stopping app services"
systemctl disable --now safevm-control-plane safevm-node-agent safevm-agent 2>/dev/null
rm -f /etc/systemd/system/safevm-control-plane.service \
      /etc/systemd/system/safevm-node-agent.service \
      /etc/systemd/system/safevm-agent.service
systemctl daemon-reload 2>/dev/null

# --- 2. desktop session containers + their network ------------------------
if command -v docker >/dev/null 2>&1; then
  echo "==> Removing desktop containers"
  for c in $(docker ps -aq --filter "name=safevm-" --format '{{.Names}}' 2>/dev/null | grep -v '^safevm-cloud-'); do
    docker rm -f "$c" >/dev/null 2>&1 && echo "    removed $c"
  done
  docker network rm safevm-desktops >/dev/null 2>&1 && echo "    removed network safevm-desktops"

  # --- 3. backing services ------------------------------------------------
  echo "==> Removing backing services"
  DOWN_ARGS=""; [[ "${PURGE_DATA:-0}" == "1" ]] && DOWN_ARGS="-v"
  if [[ -f "$COMPOSE_FILE" ]]; then
    docker compose -p "$PROJECT" -f "$COMPOSE_FILE" down $DOWN_ARGS 2>/dev/null
  else
    # repo/file already gone — tear down by known names
    docker rm -f ${PROJECT}-postgres-1 ${PROJECT}-redis-1 ${PROJECT}-rabbitmq-1 >/dev/null 2>&1
    docker network rm ${PROJECT}_default >/dev/null 2>&1
    if [[ "${PURGE_DATA:-0}" == "1" ]]; then
      docker volume rm ${PROJECT}_pgdata ${PROJECT}_redisdata ${PROJECT}_rabbitmqdata >/dev/null 2>&1
    fi
  fi

  if [[ "${PURGE_DATA:-0}" == "1" ]]; then
    echo "==> Removing pulled desktop image"
    docker rmi "${WEBTOP_IMAGE:-lscr.io/linuxserver/webtop:ubuntu-xfce}" >/dev/null 2>&1
  fi
else
  echo "    (docker not present — skipping container teardown)"
fi

# --- 4. nginx site --------------------------------------------------------
echo "==> Removing nginx site"
rm -f /etc/nginx/sites-enabled/safevm /etc/nginx/sites-available/safevm
if [[ -f /etc/nginx/sites-available/default ]]; then
  ln -sf /etc/nginx/sites-available/default /etc/nginx/sites-enabled/default
fi
if command -v nginx >/dev/null 2>&1; then
  nginx -t >/dev/null 2>&1 && systemctl reload nginx 2>/dev/null
fi

# --- 5. Bun ---------------------------------------------------------------
echo "==> Removing Bun"
rm -f /usr/local/bin/bun
rm -rf /opt/bun
for home in "/root" "/home/$APP_USER"; do
  bashrc="$home/.bashrc"
  [[ -f "$bashrc" ]] && sed -i '/\/opt\/bun/d; /# bun$/d; /BUN_INSTALL/d' "$bashrc" 2>/dev/null
done

# --- 6. the cloned repo ---------------------------------------------------
if [[ "${KEEP_REPO:-0}" == "1" ]]; then
  echo "==> Keeping repo at $INSTALL_DIR (KEEP_REPO=1)"
else
  echo "==> Removing repo $INSTALL_DIR"
  rm -rf "$INSTALL_DIR"
fi

# --- 7. optional: Docker Engine -------------------------------------------
if [[ "${REMOVE_DOCKER:-0}" == "1" ]] && command -v apt-get >/dev/null 2>&1; then
  echo "==> Purging Docker Engine"
  systemctl disable --now docker 2>/dev/null
  apt-get remove -y --purge docker-ce docker-ce-cli containerd.io \
    docker-buildx-plugin docker-compose-plugin docker-ce-rootless-extras 2>/dev/null
  rm -f /etc/apt/sources.list.d/docker.list /etc/apt/keyrings/docker.gpg
  apt-get autoremove -y 2>/dev/null
fi

# --- 8. optional: nginx ---------------------------------------------------
if [[ "${REMOVE_NGINX:-0}" == "1" ]] && command -v apt-get >/dev/null 2>&1; then
  echo "==> Purging nginx"
  systemctl disable --now nginx 2>/dev/null
  apt-get remove -y --purge nginx nginx-common 2>/dev/null
  apt-get autoremove -y 2>/dev/null
fi

# --- 9. optional: Node.js (installed for the Prisma CLI) -------------------
if [[ "${REMOVE_NODE:-0}" == "1" ]] && command -v apt-get >/dev/null 2>&1; then
  echo "==> Purging Node.js"
  apt-get remove -y --purge nodejs 2>/dev/null
  apt-get autoremove -y 2>/dev/null
fi

cat <<DONE

============================================================================
SafeVM removed.
  - App services, desktops, backing containers, nginx site, Bun, and repo: gone.
  - Data volumes: $( [[ "${PURGE_DATA:-0}" == "1" ]] && echo "DELETED" || echo "kept (re-run with PURGE_DATA=1 to delete)" )
  - Docker Engine: $( [[ "${REMOVE_DOCKER:-0}" == "1" ]] && echo "purged" || echo "kept (REMOVE_DOCKER=1 to remove)" )
  - Node.js:       $( [[ "${REMOVE_NODE:-0}" == "1" ]] && echo "purged" || echo "kept (REMOVE_NODE=1 to remove)" )
  - System packages (git, openssl, etc.): kept.
============================================================================
DONE
