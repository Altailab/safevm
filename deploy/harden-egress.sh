#!/usr/bin/env bash
# ============================================================================
# SafeVM — desktop egress lockdown. Stops desktop containers from reaching your
# private network, the host, and cloud metadata — while still allowing the
# public internet and DNS. Defense against malware scanning your LAN / hitting
# host services / stealing cloud credentials.
#
#   sudo bash deploy/harden-egress.sh        # apply
#   sudo bash deploy/harden-egress.sh off    # remove
#
# How it works: adds rules to nginx-independent iptables DOCKER-USER chain that
# DROP traffic FROM the desktop network TO RFC1918 + link-local (169.254/16,
# which includes the 169.254.169.254 cloud metadata endpoint). Public
# destinations fall through and are allowed; Docker's embedded DNS (127.0.0.11)
# is intra-namespace so name resolution is unaffected; reply traffic isn't
# matched (rules are source-scoped to the desktop subnet).
#
# Persisted with netfilter-persistent so it survives reboots.
# ============================================================================
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Run as root (sudo)." >&2; exit 1; }

NET="${DOCKER_DESKTOP_NET:-safevm-desktops}"
MARK="SAFEVM-EGRESS"

# Ensure the desktop network exists (same options the node-agent uses) so we can
# read its subnet.
if ! docker network inspect "$NET" >/dev/null 2>&1; then
  docker network create --opt com.docker.network.bridge.enable_icc=false "$NET" >/dev/null
fi
SUBNET="$(docker network inspect "$NET" -f '{{range .IPAM.Config}}{{.Subnet}}{{end}}')"
[[ -n "$SUBNET" ]] || { echo "Could not determine $NET subnet." >&2; exit 1; }

# Remove any rules we previously added (idempotent / used by `off`).
remove_rules() {
  while iptables -L DOCKER-USER -n --line-numbers 2>/dev/null | grep -q "$MARK"; do
    local n
    n="$(iptables -L DOCKER-USER -n --line-numbers | awk -v m="$MARK" '$0 ~ m {print $1; exit}')"
    [[ -n "$n" ]] && iptables -D DOCKER-USER "$n" || break
  done
}

remove_rules

if [[ "${1:-on}" == "off" ]]; then
  echo "==> Egress lockdown removed for $SUBNET"
else
  echo "==> Locking down egress for desktop subnet $SUBNET"
  # Insert at the top of DOCKER-USER so they're evaluated before Docker's accept.
  for cidr in 169.254.0.0/16 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16; do
    iptables -I DOCKER-USER -s "$SUBNET" -d "$cidr" -m comment --comment "$MARK" -j DROP
  done
  echo "    desktops can reach the internet, but not the host/LAN/metadata."
fi

# Persist across reboots.
if command -v netfilter-persistent >/dev/null 2>&1 || apt-get install -y iptables-persistent >/dev/null 2>&1; then
  netfilter-persistent save >/dev/null 2>&1 && echo "==> Saved (persists across reboot)" || true
else
  echo "WARNING: could not persist rules — they'll reset on reboot." >&2
fi
