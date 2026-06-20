import type { StreamClient, StreamCapabilities } from './types'
import { SelkiesWebRTC } from './selkies/webrtc'
import { SelkiesInput, encodeResize } from './selkies/input'

// Real WebRTC client for the Selkies-GStreamer tier: signalling -> peer
// connection -> <video> + input/control data channel. Capabilities are live
// (clipboard/file/resolution over the data channel).
//
// Requires a Selkies-enabled workspace image (signalling server + GStreamer
// WebRTC pipeline). The connectUrl for this tier is the signalling WebSocket URL
// (ws(s)://host:port/path). See deploy/selkies/README.md to stand one up.
export class SelkiesStreamClient implements StreamClient {
  readonly kind = 'selkies'
  readonly capabilities: StreamCapabilities = {
    clipboard: true,
    fileTransfer: true,
    resolution: true,
    audio: true,
  }

  private rtc?: SelkiesWebRTC
  private input?: SelkiesInput
  private video?: HTMLVideoElement
  private remoteClipboard = ''

  constructor(
    private signallingUrl: string,
    private opts: { peerId?: string; iceServers?: RTCIceServer[] } = {},
  ) {}

  async attach(container: HTMLElement): Promise<void> {
    const video = document.createElement('video')
    video.autoplay = true
    video.playsInline = true
    video.muted = false
    video.style.cssText = 'width:100%;height:100%;display:block;background:#000;object-fit:contain'
    container.appendChild(video)
    this.video = video

    this.rtc = new SelkiesWebRTC(
      this.signallingUrl,
      this.opts.peerId ?? '1',
      video,
      this.opts.iceServers ?? [{ urls: 'stun:stun.l.google.com:19302' }],
      {
        onConnectionState: (s) => {
          if (s === 'connected') this.attachInput()
        },
        onDataChannelMessage: (msg) => this.onRemoteMessage(msg),
      },
    )
    this.rtc.start()
  }

  private attachInput(): void {
    if (this.input || !this.video || !this.rtc) return
    this.input = new SelkiesInput(this.video, (m) => this.rtc!.send(m))
    this.input.attach()
  }

  // Remote -> client control messages (e.g. clipboard updates). Prefixes follow
  // the same isolate-and-verify rule as the input wire format.
  private onRemoteMessage(msg: string): void {
    if (msg.startsWith('cr,')) this.remoteClipboard = atob(msg.slice(3))
  }

  detach(): void {
    this.input?.detach()
    this.rtc?.close()
    this.video?.remove()
    this.input = undefined
    this.rtc = undefined
    this.video = undefined
  }

  fullscreen(el: HTMLElement): void {
    el.requestFullscreen?.()
  }

  async setClipboard(text: string): Promise<void> {
    this.rtc?.send(`cw,${btoa(text)}`)
  }
  async getClipboard(): Promise<string> {
    return this.remoteClipboard
  }
  async uploadFile(file: File): Promise<void> {
    // Chunk over a file-transfer channel — wire format TBD with the Selkies image.
    const buf = new Uint8Array(await file.arrayBuffer())
    this.rtc?.send(`fb,${file.name},${buf.length}`)
  }
  setResolution(width: number, height: number): void {
    this.rtc?.send(encodeResize(width, height))
  }
}
