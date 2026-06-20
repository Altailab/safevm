// Selkies / gstwebrtc-demos WebSocket signalling client.
//
// Protocol (verified against centricular/gstwebrtc-demos Protocol.md, which
// Selkies-GStreamer uses):
//   peer -> server: "HELLO <uid>"          server -> peer: "HELLO"
//   peer -> server: "SESSION <peer_uid>"   server -> peer: "SESSION_OK"
//   then SDP/ICE as JSON: {"sdp": {...}} / {"ice": {...}}
//   any "ERROR ..." string is a failure.
//
// In Selkies the GStreamer side is the SDP offerer, so this web client is the
// callee: it registers, opens the session, then answers the incoming offer.

export interface SignallingHandlers {
  onRegistered: () => void
  onSessionOk: () => void
  onSdp: (sdp: RTCSessionDescriptionInit) => void
  onIce: (ice: RTCIceCandidateInit) => void
  onError: (message: string) => void
  onClose: () => void
}

export class SelkiesSignalling {
  private ws?: WebSocket

  constructor(
    private url: string,
    private peerId: string, // the GStreamer app's id to pair with
    private myId: string, // our random registration id
    private h: SignallingHandlers,
  ) {}

  connect(): void {
    const ws = new WebSocket(this.url)
    this.ws = ws
    ws.onopen = () => ws.send(`HELLO ${this.myId}`)
    ws.onerror = () => this.h.onError('signalling websocket error')
    ws.onclose = () => this.h.onClose()
    ws.onmessage = (e) => this.onMessage(String(e.data))
  }

  private onMessage(data: string): void {
    if (data === 'HELLO') {
      this.h.onRegistered()
      this.send(`SESSION ${this.peerId}`)
      return
    }
    if (data === 'SESSION_OK') {
      this.h.onSessionOk()
      return
    }
    if (data.startsWith('ERROR')) {
      this.h.onError(data)
      return
    }
    let msg: { sdp?: RTCSessionDescriptionInit; ice?: RTCIceCandidateInit }
    try {
      msg = JSON.parse(data)
    } catch {
      return
    }
    if (msg.sdp) this.h.onSdp(msg.sdp)
    else if (msg.ice) this.h.onIce(msg.ice)
  }

  sendSdp(sdp: RTCSessionDescriptionInit): void {
    this.send(JSON.stringify({ sdp }))
  }

  sendIce(ice: RTCIceCandidateInit): void {
    this.send(JSON.stringify({ ice }))
  }

  private send(s: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(s)
  }

  close(): void {
    this.ws?.close()
    this.ws = undefined
  }
}
