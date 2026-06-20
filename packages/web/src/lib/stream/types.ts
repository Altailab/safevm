// Pluggable streaming client. The SafeVM session viewer renders a branded
// toolbar and delegates the actual desktop streaming + control-channel actions
// to one of these adapters — mirroring the node-agent runtime split:
//   iframe   — current tier (KasmVNC/Webtop over HTTP). Limited control channel.
//   selkies  — WebRTC tier (Selkies-GStreamer). Full clipboard/file/resolution.
//
// New adapters implement this interface and the viewer/toolbar stay unchanged.

export interface StreamCapabilities {
  clipboard: boolean
  fileTransfer: boolean
  resolution: boolean
  audio: boolean
}

export interface StreamClient {
  readonly kind: string
  readonly capabilities: StreamCapabilities

  // Mount the live desktop into the given element.
  attach(container: HTMLElement): Promise<void>
  // Tear down and release resources.
  detach(): void

  fullscreen(el: HTMLElement): void

  // Control-channel actions — present only when the matching capability is true.
  setClipboard?(text: string): Promise<void>
  getClipboard?(): Promise<string>
  uploadFile?(file: File): Promise<void>
  setResolution?(width: number, height: number): void
}
