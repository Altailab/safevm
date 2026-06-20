#!/usr/bin/env bash
# ============================================================================
# SafeVM — updater. Rolls an existing install forward to a new version.
# ----------------------------------------------------------------------------
# Unlike install-ubuntu.sh, this PRESERVES your config and data:
#   - keeps .env as-is (JWT_SECRET unchanged → existing logins stay valid)
#   - does NOT re-seed (your admin user / data are untouched)
#   - backs up Postgres before applying migrations
#
# What it does: pulls the new code, reinstalls deps, regenerates the Prisma
# client, rebuilds the dashboard, applies new DB migrations, and restarts the
# services. Downtime is only the migrate + restart window (a few seconds).
#
# Run as root, from the box:
#   sudo bash /opt/safevm/deploy/update-ubuntu.sh
#   curl -fsSL https://raw.githubusercontent.com/Altailab/safevm/main/deploy/update-ubuntu.sh | sudo bash
#
# Flags (env vars):
#   SAFEVM_REF=v1.2.0   branch/tag/commit to update to   (default main)
#   INSTALL_DIR=...      install location                 (default /opt/safevm)
#   SKIP_BACKUP=1        skip the pre-migration pg_dump
#   FORCE=1             re-run build/migrate even if already on the target ref
# ============================================================================
set -euo pipefail

[[ $EUID -eq 0 ]] || { echo "Run as root (sudo)." >&2; exit 1; }

INSTALL_DIR="${INSTALL_DIR:-/opt/safevm}"
SAFEVM_REF="${SAFEVM_REF:-main}"
BUN="/opt/bun/bin/bun"
COMPOSE_FILE="$INSTALL_DIR/deploy/docker-compose.yml"
BACKUP_DIR="/var/backups/safevm"

# --- preflight: must be an existing install --------------------------------
[[ -d "$INSTALL_DIR/.git" ]] || { echo "No SafeVM repo at $INSTALL_DIR — run install-ubuntu.sh first." >&2; exit 1; }
[[ -f "$INSTALL_DIR/.env" ]] || { echo "No $INSTALL_DIR/.env — run install-ubuntu.sh first." >&2; exit 1; }
[[ -x "$BUN" ]] || { echo "Bun not found at $BUN — run install-ubuntu.sh first." >&2; exit 1; }

# Owner the services run as (the user that owns the repo).
APP_USER="${APP_USER:-$(stat -c '%U' "$INSTALL_DIR")}"
run_app() { sudo -u "$APP_USER" bash -lc "cd '$INSTALL_DIR/packages/control-plane' && set -a && . '$INSTALL_DIR/.env' && set +a && $1"; }

cd "$INSTALL_DIR"
OLD_REV="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"

echo "==> Fetching $SAFEVM_REF"
git fetch --depth 1 origin "$SAFEVM_REF"
NEW_REV="$(git rev-parse --short FETCH_HEAD)"

if [[ "$OLD_REV" == "$NEW_REV" && "${FORCE:-0}" != "1" ]]; then
  echo "Already up to date ($OLD_REV). Use FORCE=1 to rebuild anyway."
  exit 0
fi

echo "==> Updating $OLD_REV -> $NEW_REV"
# .env / node_modules / dist are untracked (gitignored), so checkout leaves them.
git checkout -f FETCH_HEAD
chown -R "$APP_USER" "$INSTALL_DIR"

# Node is needed for the Prisma CLI (it hangs under Bun); ensure it's present.
command -v node >/dev/null 2>&1 || { apt-get update -y && apt-get install -y nodejs; }

echo "==> Installing dependencies"
sudo -u "$APP_USER" --preserve-env=PATH bash -lc "cd '$INSTALL_DIR' && '$BUN' install"

echo "==> Regenerating Prisma client (Node)"
run_app "./node_modules/.bin/prisma generate"

echo "==> Rebuilding dashboard"
sudo -u "$APP_USER" bash -lc "cd '$INSTALL_DIR/packages/web' && '$BUN' run build"

# --- backup Postgres before touching the schema ----------------------------
if [[ "${SKIP_BACKUP:-0}" != "1" ]]; then
  mkdir -p "$BACKUP_DIR"
  STAMP="$(date +%Y%m%d-%H%M%S)"
  DUMP="$BACKUP_DIR/safevm-$STAMP.sql"
  echo "==> Backing up Postgres -> $DUMP"
  if docker compose -f "$COMPOSE_FILE" exec -T postgres pg_dump -U safevm safevm </dev/null > "$DUMP" 2>/dev/null; then
    echo "    backup OK ($(du -h "$DUMP" | cut -f1))"
  else
    echo "    WARNING: backup failed — aborting before migrations (set SKIP_BACKUP=1 to override)." >&2
    rm -f "$DUMP"
    exit 1
  fi
fi

# --- apply migrations with services stopped (avoid old-code vs new-schema) --
echo "==> Stopping services"
systemctl stop safevm-control-plane safevm-node-agent safevm-agent 2>/dev/null || true

echo "==> Applying migrations (Node)"
run_app "./node_modules/.bin/prisma migrate deploy"

echo "==> Starting services"
systemctl start safevm-control-plane safevm-node-agent safevm-agent

cat <<DONE

============================================================================
SafeVM updated: $OLD_REV -> $NEW_REV  (ref: $SAFEVM_REF)
  - Config (.env / JWT secret) and data: preserved.
  - DB backup: $( [[ "${SKIP_BACKUP:-0}" == "1" ]] && echo "skipped" || echo "$DUMP" )
  - Services restarted. Check: systemctl status safevm-control-plane

Roll back if needed:
  cd $INSTALL_DIR && sudo git checkout -f $OLD_REV && \\
    sudo bash deploy/update-ubuntu.sh FORCE=1   # (then restore the .sql dump if a migration ran)
============================================================================
DONE
