#!/usr/bin/env bash
# ============================================================================
# SafeVM — interactive fresh install. Wipes any existing install INCLUDING ALL
# DATA, then reinstalls from scratch, prompting for the important settings.
#
#   ⚠️  DESTROYS the existing database. For an in-place upgrade that PRESERVES
#       data, use update-ubuntu.sh instead.
#
# Run as root:
#   curl -fsSL https://raw.githubusercontent.com/Altailab/safevm/main/deploy/fresh-install.sh | sudo bash
#
# Prompts for: public address, HTTPS, admin email + password, runtime.
# Any value pre-set in the environment is used as-is and not prompted, so you can
# still run it non-interactively, e.g.:
#   ... | sudo PUBLIC_ADDR=desktops.you.com TLS_EMAIL=you@you.com ASSUME_YES=1 bash
# ============================================================================
set -euo pipefail

[[ $EUID -eq 0 ]] || { echo "Run as root (sudo)." >&2; exit 1; }

INSTALL_DIR="${INSTALL_DIR:-/opt/safevm}"
INSTALLER_URL="${INSTALLER_URL:-https://raw.githubusercontent.com/Altailab/safevm/main/deploy/install-ubuntu.sh}"

# Re-exec from a temp copy if running from a file inside the install dir (the
# uninstall below would otherwise delete this script mid-run).
SELF="${BASH_SOURCE[0]:-}"
if [[ -f "$SELF" && "$SELF" == "$INSTALL_DIR"/* ]]; then
  cp "$SELF" /tmp/safevm-fresh-install.sh
  exec bash /tmp/safevm-fresh-install.sh
fi

have_tty() { [[ -e /dev/tty ]]; }
is_ip() { [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || [[ "$1" == *:*:* ]]; }

# ask VAR "prompt" "default" — keeps an existing env value, else prompts /dev/tty.
ask() {
  local var="$1" prompt="$2" def="${3:-}" val
  [[ -n "${!var:-}" ]] && return
  if ! have_tty; then printf -v "$var" '%s' "$def"; return; fi
  if [[ -n "$def" ]]; then
    read -r -p "$prompt [$def]: " val </dev/tty || true
    printf -v "$var" '%s' "${val:-$def}"
  else
    read -r -p "$prompt: " val </dev/tty || true
    printf -v "$var" '%s' "$val"
  fi
}

ask_secret() { # ask_secret VAR "prompt" — hidden input with confirmation
  local var="$1" prompt="$2" p1 p2
  [[ -n "${!var:-}" ]] && return
  have_tty || return  # non-interactive: leave empty → installer auto-generates
  while true; do
    read -rs -p "$prompt (blank = auto-generate): " p1 </dev/tty; echo >/dev/tty
    [[ -z "$p1" ]] && return
    read -rs -p "Confirm: " p2 </dev/tty; echo >/dev/tty
    [[ "$p1" == "$p2" ]] && { printf -v "$var" '%s' "$p1"; return; }
    echo "  passwords don't match, try again" >/dev/tty
  done
}

echo "=== SafeVM fresh install ==="

# --- public address (required) ---------------------------------------------
while :; do
  PUBLIC_ADDR=""; ask PUBLIC_ADDR "Public address (domain or server IP)"
  [[ -z "$PUBLIC_ADDR" ]] && { echo "  required."; have_tty || exit 1; continue; }
  [[ "$PUBLIC_ADDR" == *example.com* ]] && { echo "  that's the placeholder — use your real domain/IP."; have_tty || exit 1; continue; }
  break
done

# --- HTTPS (domains only; Let's Encrypt can't cert a bare IP) ---------------
if is_ip "$PUBLIC_ADDR"; then
  echo "  $PUBLIC_ADDR is an IP — HTTPS needs a domain, so serving plain HTTP."
  TLS_EMAIL="${TLS_EMAIL:-}"
  ask HTTP_PORT "HTTP port" "80"
else
  ask TLS_EMAIL "Email for Let's Encrypt HTTPS (blank = HTTP only)" ""
fi

# --- admin login -----------------------------------------------------------
default_admin="admin@safevm.local"; is_ip "$PUBLIC_ADDR" || default_admin="admin@${PUBLIC_ADDR#*.}"
ask SEED_ADMIN_EMAIL "Admin email" "$default_admin"
ask_secret SEED_ADMIN_PASSWORD "Admin password"

# --- runtime ---------------------------------------------------------------
ask RUNTIME "Isolation runtime (docker|mock|firecracker)" "docker"

# --- summary + confirm -----------------------------------------------------
scheme="http"; [[ -n "${TLS_EMAIL:-}" ]] && scheme="https"
cat <<SUMMARY

  Dashboard:  $scheme://$PUBLIC_ADDR${HTTP_PORT:+:$HTTP_PORT}
  HTTPS:      $([[ -n "${TLS_EMAIL:-}" ]] && echo "yes (Let's Encrypt, $TLS_EMAIL)" || echo "no")
  Admin:      $SEED_ADMIN_EMAIL
  Password:   $([[ -n "${SEED_ADMIN_PASSWORD:-}" ]] && echo "(set)" || echo "(auto-generated)")
  Runtime:    $RUNTIME

  ⚠️  This DESTROYS any existing SafeVM install and database on this box.
SUMMARY

if [[ "${ASSUME_YES:-0}" != "1" ]] && have_tty; then
  read -r -p "Proceed? type 'yes': " ok </dev/tty || true
  [[ "$ok" == "yes" ]] || { echo "Aborted."; exit 1; }
fi

export PUBLIC_ADDR TLS_EMAIL SEED_ADMIN_EMAIL SEED_ADMIN_PASSWORD RUNTIME
[[ -n "${HTTP_PORT:-}" ]] && export HTTP_PORT
# We've already collected everything — tell the installer not to prompt again.
export SAFEVM_NONINTERACTIVE=1

# --- 1. tear down existing install + data ----------------------------------
if [[ -f "$INSTALL_DIR/deploy/uninstall-ubuntu.sh" ]]; then
  echo "==> Removing existing install (PURGE_DATA=1)"
  PURGE_DATA=1 ASSUME_YES=1 SAFEVM_NONINTERACTIVE=1 \
    bash "$INSTALL_DIR/deploy/uninstall-ubuntu.sh" </dev/null
else
  echo "==> No existing install at $INSTALL_DIR — nothing to remove"
fi

# --- 2. fresh install ------------------------------------------------------
echo "==> Fresh install"
curl -fsSL "$INSTALLER_URL" | bash
