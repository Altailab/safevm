# Streaming client & session viewer

The desktop is streamed into the dashboard by an **in-app session viewer** with a
**SafeVM-branded toolbar**, instead of opening the raw stream URL in a new tab.
The actual transport is a **pluggable `StreamClient` adapter** — the same
plugin pattern as the node-agent runtimes and the agent models.

## Adapters (`packages/web/src/lib/stream/`)

| Adapter | Transport | Control channel | Status |
|---|---|---|---|
| `iframe` | KasmVNC/Webtop over HTTP, embedded in an `<iframe>` | none | **wired (current tier)** |
| `selkies` | Selkies-GStreamer (WebRTC) | clipboard, file transfer, resolution | **implemented** (signalling + peer connection + input); validate against a live Selkies image — see [`../deploy/selkies/README.md`](../deploy/selkies/README.md) |

### Selkies adapter internals (`lib/stream/selkies/`)

- `signalling.ts` — WebSocket signalling (`HELLO`/`SESSION`/`sdp`/`ice`), web client as callee.
- `webrtc.ts` — `RTCPeerConnection`: answers the GStreamer offer, mounts the video track, relays ICE, holds the input data channel.
- `input.ts` — DOM mouse/keyboard/wheel capture → data channel; wire format isolated in `encode*` helpers to match the deployed Selkies `input.js`.
- `selkies-client.ts` — implements `StreamClient`; clipboard/file/resolution go over the data channel.

Select it at runtime with `/sessions/<id>?stream=selkies` (default is `iframe`).

New transports implement the `StreamClient` interface (`attach`/`detach`/
`fullscreen` + optional `setClipboard`/`getClipboard`/`uploadFile`/`setResolution`)
and the viewer/toolbar stay unchanged. The factory `makeStreamClient(url, kind)`
picks the adapter; today every session is `iframe` (once the node-agent reports a
per-session stream kind, pass it through).

## The toolbar — floating widget (`components/safevm/stream-toolbar.tsx`)

A **draggable, collapsible floating widget** overlaid on the live stream (works
over both the iframe `<iframe>` and the WebRTC `<video>`): a SafeVM pill with a
grip handle, the workspace name + connection badge, a collapse toggle, and the
action row below. Native SafeVM controls, not the upstream desktop's chrome:

- **Generic, wired now:** back, Copy link, **Open in new tab**, Fullscreen, Disconnect (stops the session).
- **Capability + policy gated:** Clipboard, Upload file, Resolution — enabled only
  when the adapter advertises the capability **and** the workspace `policy` allows
  it. Disabled buttons explain why ("Available on the Selkies tier" / "Disabled by
  workspace policy"). These light up on the `selkies` adapter.
- **SafeVM-specific (placeholders):** **Open in sandbox** (the disposable
  detonation sandbox, Phase 2) and **Hand to agent** (co-pilot take-over for the
  agent track).

## Readiness gating

A container reports `running` the instant it starts, but its HTTP desktop takes a
few more seconds. The viewer therefore:

1. Polls the session until the control plane provides a `connectUrl`
   (*"Provisioning session…"*).
2. Runs `probeReady(url)` — a `no-cors` fetch that resolves only once the port
   actually serves — in a loop (*"Starting desktop — waiting for it to come up…"*).
3. Mounts the stream only when reachable; the badge flips to **connected**.

No more blank/premature new-tab opens.

## Stale-status reconciliation

Sessions used to get stuck showing `running` after their container died. Fix: the
node-agent emits a `session.reconcile` heartbeat every 10s listing the session IDs
with live containers (`Runtime.list()`, implemented by the Docker runtime). The
control plane marks any `running`/`starting` session on that node **not** in the
list as `stopped`. Verified: removing a container flips its session to `stopped`
within one heartbeat.

## Wiring Selkies (next)

Selkies-GStreamer is open source (MPL-2.0 — file-level copyleft; composes with our
source-available app, verify per-component before forking). To enable the `selkies` adapter:

1. Build a **Selkies-enabled workspace image** (signalling server + GStreamer
   WebRTC pipeline) for the streaming-rootfs / Firecracker tier.
2. Implement `SelkiesStreamClient.attach()` against the Selkies core (signalling →
   peer connection → `<video>` + input/data channel), and the control-channel
   methods (clipboard/file/resolution) over that data channel.
3. Have the node-agent report `streamKind: 'selkies'` per session so the factory
   selects it. The toolbar's gated buttons then activate automatically.
