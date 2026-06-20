#!/usr/bin/env bash
# Fetch a guest kernel + a minimal rootfs for a first Firecracker boot.
# Lands them in /srv/safevm/images as referenced by the seeded "debian-desktop"
# image (kernelRef=images/debian/vmlinux, rootfsRef=images/debian/rootfs.ext4).
#
# This pulls a MINIMAL boot image to prove the runtime. The real desktop image
# (Debian + KasmVNC/Selkies streaming server) is built separately — see README.
set -euo pipefail

IMAGE_DIR="${FC_IMAGE_DIR:-/srv/safevm/images}"
ARCH="$(uname -m)"
DEST="${IMAGE_DIR}/debian"
mkdir -p "$DEST"

# Firecracker CI publishes known-good kernels + rootfs. Verify current paths at:
#   https://github.com/firecracker-microvm/firecracker/blob/main/docs/getting-started.md
CI_BASE="https://s3.amazonaws.com/spec.ccfc.min/firecracker-ci/v1.10/${ARCH}"

echo "==> Kernel"
if [[ ! -f "${DEST}/vmlinux" ]]; then
  # Grab the newest vmlinux listed for this CI version.
  KEY="$(curl -fsSL "${CI_BASE}/vmlinux-5.10.bin" -o "${DEST}/vmlinux" && echo ok || echo fail)"
  [[ "$KEY" == "ok" ]] || { echo "Kernel download failed — check CI_BASE URL." >&2; exit 1; }
fi

echo "==> Rootfs (minimal)"
if [[ ! -f "${DEST}/rootfs.ext4" ]]; then
  curl -fsSL "${CI_BASE}/ubuntu-22.04.ext4" -o "${DEST}/rootfs.ext4" \
    || { echo "Rootfs download failed — check CI_BASE URL or build your own (see README)." >&2; exit 1; }
fi

echo "==> Images in ${DEST}:"
ls -lh "$DEST"
echo "Done. A boot with these proves the runtime; swap in a streaming-enabled rootfs for real desktops."
