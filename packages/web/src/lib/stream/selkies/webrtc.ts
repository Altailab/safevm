import { SelkiesSignalling } from './signalling'

// WebRTC peer connection for the Selkies stream. The GStreamer side offers; we
// answer. Video lands on the <video> element; an `input` DataChannel (created by
// the GStreamer webrtcbin) carries input + control messages.
export interface WebRTCHandlers {
  onConnectionState: (state: RTCPeerConnectionState) => void
  onDataChannelMessage?: (msg: string) => void // remote -> client (e.g. clipboard)
}

export class SelkiesWebRTC {
  private pc?: RTCPeerConnection
  private dc?: RTCDataChannel
  private signalling: SelkiesSignalling

  constructor(
    signallingUrl: string,
    peerId: string,
    private video: HTMLVideoElement,
    private iceServers: RTCIceServer[],
    private h: WebRTCHandlers,
  ) {
    const myId = String(Math.floor(Math.random() * 1e9))
    this.signalling = new SelkiesSignalling(signallingUrl, peerId, myId, {
      onRegistered: () => {},
      onSessionOk: () => this.ensurePc(),
      onSdp: (sdp) => this.onSdp(sdp),
      onIce: (ice) => this.pc?.addIceCandidate(ice).catch(() => {}),
      onError: (m) => console.error('[selkies signalling]', m),
      onClose: () => this.h.onConnectionState('closed'),
    })
  }

  start(): void {
    this.signalling.connect()
  }

  private ensurePc(): RTCPeerConnection {
    if (this.pc) return this.pc
    const pc = new RTCPeerConnection({ iceServers: this.iceServers })
    pc.ontrack = (e) => {
      if (e.track.kind === 'video') {
        this.video.srcObject = e.streams[0]
        this.video.play().catch(() => {})
      }
    }
    pc.onicecandidate = (e) => {
      if (e.candidate) this.signalling.sendIce(e.candidate.toJSON())
    }
    pc.ondatachannel = (e) => {
      this.dc = e.channel
      this.dc.onmessage = (ev) => this.h.onDataChannelMessage?.(String(ev.data))
    }
    pc.onconnectionstatechange = () => this.h.onConnectionState(pc.connectionState)
    this.pc = pc
    return pc
  }

  private async onSdp(sdp: RTCSessionDescriptionInit): Promise<void> {
    const pc = this.ensurePc()
    await pc.setRemoteDescription(sdp)
    if (sdp.type === 'offer') {
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      if (pc.localDescription) this.signalling.sendSdp(pc.localDescription)
    }
  }

  // Send an input/control message over the data channel.
  send(msg: string): boolean {
    if (this.dc?.readyState === 'open') {
      this.dc.send(msg)
      return true
    }
    return false
  }

  close(): void {
    this.dc?.close()
    this.pc?.close()
    this.signalling.close()
    this.pc = undefined
    this.dc = undefined
  }
}
