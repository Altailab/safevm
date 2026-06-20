#!/usr/bin/env bash
# Prepare an Ubuntu (22.04/24.04) host to run SafeVM Firecracker microVMs.
# Run as root on a Linux + KVM box (e.g. a Hetzner Cloud server).
#
#   sudo bash deploy/firecracker/setup-host.sh
#
# Idempotent-ish; safe to re-run. NOT for macOS.
set -euo pipefail

FC_VERSION="${FC_VERSION:-v1.10.1}"   # verify latest at github.com/firecracker-microvm/firecracker/releases
ARCH="$(uname -m)"                    # x86_64 | aarch64
EGRESS_IF="${EGRESS_IF:-$(ip route show default | awk '/default/ {print $5; exit}')}"
VM_SUBNET="172.16.0.0/16"

echo "==> Checking KVM"
if [[ ! -e /dev/kvm ]]; then
  echo "ERROR: /dev/kvm missing. Enable nested virtualization / use a KVM-capable host." >&2
  exit 1
fi

echo "==> Installing prerequisites"
apt-get update -y
apt-get install -y curl iproute2 iptables ca-certificates e2fsprogs

echo "==> Installing Firecracker ${FC_VERSION} (${ARCH})"
if ! command -v firecracker >/dev/null 2>&1; then
  tmp="$(mktemp -d)"
  curl -fsSL "https://github.com/firecracker-microvm/firecracker/releases/download/${FC_VERSION}/firecracker-${FC_VERSION}-${ARCH}.tgz" \
    | tar -xz -C "$tmp"
  install -m 0755 "$tmp/release-${FC_VERSION}-${ARCH}/firecracker-${FC_VERSION}-${ARCH}" /usr/local/bin/firecracker
  rm -rf "$tmp"
fi
firecracker --version || true

echo "==> Enabling IP forwarding"
sysctl -w net.ipv4.ip_forward=1
sed -i 's/^#\?net.ipv4.ip_forward.*/net.ipv4.ip_forward=1/' /etc/sysctl.conf || true

echo "==> Egress NAT for VM subnet via ${EGRESS_IF}"
# Masquerade VM traffic. Per-VM default-deny egress is layered on top by the
# control plane's policy engine (allowlists); this is the base NAT path.
iptables -t nat -C POSTROUTING -s "$VM_SUBNET" -o "$EGRESS_IF" -j MASQUERADE 2>/dev/null \
  || iptables -t nat -A POSTROUTING -s "$VM_SUBNET" -o "$EGRESS_IF" -j MASQUERADE
iptables -C FORWARD -i "$EGRESS_IF" -o "fc-tap+" -m state --state RELATED,ESTABLISHED -j ACCEPT 2>/dev/null \
  || iptables -A FORWARD -i "$EGRESS_IF" -o "fc-tap+" -m state --state RELATED,ESTABLISHED -j ACCEPT
iptables -C FORWARD -i "fc-tap+" -o "$EGRESS_IF" -j ACCEPT 2>/dev/null \
  || iptables -A FORWARD -i "fc-tap+" -o "$EGRESS_IF" -j ACCEPT

echo "==> Creating image/run dirs"
mkdir -p /srv/safevm/images /srv/safevm/run

echo "==> Done. Next:"
echo "    1) bash deploy/firecracker/fetch-images.sh   # kernel + rootfs"
echo "    2) RUNTIME=firecracker bun run dev:agent      # point at your RabbitMQ/Redis"
