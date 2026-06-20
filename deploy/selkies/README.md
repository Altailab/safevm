# Selkies (WebRTC) tier — running a workspace to validate the adapter

The `selkies` `StreamClient` (`packages/web/src/lib/stream/selkies/`) is a real
WebRTC client — signalling, peer connection, `<video>`, and an input/control data
channel. To exercise it end-to-end you need a **Selkies-enabled workspace image**
(a desktop running the Selkies-GStreamer pipeline + signalling server). The `iframe`
tier (KasmVNC/Webtop) does **not** speak WebRTC, so the adapter has no server to
talk to until this image exists.

## What the image must provide

- An X desktop (XFCE/etc.) captured by **Selkies-GStreamer** (`selkies-gstreamer`).
- The **signalling WebSocket server** (gstwebrtc-demos style: `HELLO`/`SESSION`/
  `sdp`/`ice`).
- A TURN/STUN server for NAT traversal (coturn) — or rely on STUN for same-host dev.

Reference images from the Selkies project (GPU-oriented; see their docs):
`ghcr.io/selkies-project/selkies-gstreamer/*` and the
`docker-nvidia-egl-desktop` / `docker-nvidia-glx-desktop` desktops.

## Wiring it into SafeVM

1. Build/run the Selkies workspace so its **signalling WebSocket** is reachable,
   e.g. `ws://<host>:<port>/ws`.
2. Point the session's `connectUrl` at that WS URL (a `docker-selkies` runtime
   variant, or set it manually for a test session).
3. Open the viewer with the WebRTC tier selected:
   `/sessions/<id>?stream=selkies`. The viewer skips the HTTP readiness probe,
   negotiates WebRTC, and mounts the `<video>`; the floating toolbar's
   clipboard / file / resolution buttons activate (capabilities are live).

## Honest status / caveats

- **Adapter: implemented, not yet validated against a live server.** The
  signalling protocol matches centricular/gstwebrtc-demos (which Selkies uses).
  Two things to confirm on first real run, both isolated for easy fixes:
  - the **peer id** the GStreamer app registers as (default `'1'` in
    `SelkiesStreamClient`), and
  - the **input wire format** in `selkies/input.ts` (`encode*` helpers) — match it
    to the `input.js` the chosen Selkies image ships.
- **Mac caveat:** Selkies wants a real GPU/X stack; it won't run cleanly on Docker
  Desktop. Validate on a **Linux host** — the same box as the Firecracker tier
  (see [`../firecracker/README.md`](../firecracker/README.md) /
  [`../hetzner/README.md`](../hetzner/README.md)).
