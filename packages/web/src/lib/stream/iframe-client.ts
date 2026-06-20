import type { StreamClient, StreamCapabilities } from './types'

// Current tier: embed the KasmVNC/Webtop desktop (served over HTTP) in an iframe.
// The plain iframe has no control channel, so clipboard/file/resolution are not
// available here — they light up on the Selkies (WebRTC) adapter.
export class IframeStreamClient implements StreamClient {
  readonly kind = 'iframe'
  readonly capabilities: StreamCapabilities = {
    clipboard: false,
    fileTransfer: false,
    resolution: false,
    audio: true,
  }
  private iframe?: HTMLIFrameElement

  constructor(private url: string) {}

  async attach(container: HTMLElement): Promise<void> {
    const f = document.createElement('iframe')
    f.src = this.url
    f.title = 'SafeVM desktop'
    f.allow = 'clipboard-read; clipboard-write; fullscreen; microphone; camera'
    f.style.cssText = 'width:100%;height:100%;border:0;display:block;background:#000'
    container.appendChild(f)
    this.iframe = f
  }

  detach(): void {
    this.iframe?.remove()
    this.iframe = undefined
  }

  fullscreen(el: HTMLElement): void {
    el.requestFullscreen?.()
  }
}
