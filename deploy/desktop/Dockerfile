# Hardened SafeVM desktop image — extends linuxserver/webtop (KasmVNC/XFCE) and
# physically removes in-container privilege-escalation paths.
#
# Note: at runtime the node-agent already launches desktops with
# `--security-opt no-new-privileges` + `--cap-drop ALL`, which neutralizes
# setuid escalation even if sudo/su exist. Removing them here is defense in depth.
#
# Build & use:
#   docker build -t safevm/webtop-hardened deploy/desktop
#   WEBTOP_IMAGE=safevm/webtop-hardened   # set in the node-agent env (.env)
FROM lscr.io/linuxserver/webtop:ubuntu-xfce

# Strip sudo and the setuid bits off su/mount/etc. so an in-desktop user can't
# attempt to escalate. (no-new-privileges makes this moot, but belt + braces.)
RUN apt-get remove -y --purge sudo 2>/dev/null || true; \
    for b in /bin/su /usr/bin/su /bin/mount /bin/umount /usr/bin/newgrp \
             /usr/bin/chsh /usr/bin/chfn /usr/bin/gpasswd /usr/bin/passwd; do \
      [ -e "$b" ] && chmod u-s "$b" || true; \
    done; \
    apt-get clean; rm -rf /var/lib/apt/lists/*
