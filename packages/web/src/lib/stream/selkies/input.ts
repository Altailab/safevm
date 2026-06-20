// Capture DOM mouse/keyboard/wheel on the video element and send them over the
// Selkies input data channel.
//
// WIRE FORMAT: the encode* helpers below isolate the exact message strings. They
// follow Selkies' comma-delimited convention; confirm against the deployed
// Selkies version (the `input.js` it ships) and adjust here only — the rest of
// the stack is format-agnostic.

type Send = (msg: string) => void

function encodeMouseMove(x: number, y: number): string {
  return `m,${Math.round(x)},${Math.round(y)}`
}
function encodeMouseButton(button: number, down: boolean): string {
  return `b,${button},${down ? 1 : 0}`
}
function encodeWheel(dx: number, dy: number): string {
  return `s,${Math.round(dx)},${Math.round(dy)}`
}
function encodeKey(keysym: number, down: boolean): string {
  return `k,${keysym},${down ? 1 : 0}`
}
export function encodeResize(w: number, h: number): string {
  return `r,${Math.round(w)},${Math.round(h)}`
}

// Map a browser KeyboardEvent to an X11 keysym (ASCII range covers most keys;
// extend for special keys when validating against the server).
function toKeysym(e: KeyboardEvent): number {
  if (e.key.length === 1) return e.key.charCodeAt(0)
  const specials: Record<string, number> = {
    Enter: 0xff0d,
    Backspace: 0xff08,
    Tab: 0xff09,
    Escape: 0xff1b,
    ArrowLeft: 0xff51,
    ArrowUp: 0xff52,
    ArrowRight: 0xff53,
    ArrowDown: 0xff54,
    Shift: 0xffe1,
    Control: 0xffe3,
    Alt: 0xffe9,
    ' ': 0x0020,
  }
  return specials[e.key] ?? 0
}

export class SelkiesInput {
  private listeners: Array<[string, EventListener]> = []

  constructor(
    private el: HTMLVideoElement,
    private send: Send,
  ) {}

  attach(): void {
    const remoteCoords = (e: MouseEvent) => {
      const rect = this.el.getBoundingClientRect()
      const sx = (this.el.videoWidth || rect.width) / rect.width
      const sy = (this.el.videoHeight || rect.height) / rect.height
      return { x: (e.clientX - rect.left) * sx, y: (e.clientY - rect.top) * sy }
    }

    this.on('mousemove', (e) => {
      const { x, y } = remoteCoords(e as MouseEvent)
      this.send(encodeMouseMove(x, y))
    })
    this.on('mousedown', (e) => this.send(encodeMouseButton((e as MouseEvent).button + 1, true)))
    this.on('mouseup', (e) => this.send(encodeMouseButton((e as MouseEvent).button + 1, false)))
    this.on('contextmenu', (e) => e.preventDefault())
    this.on('wheel', (e) => {
      const we = e as WheelEvent
      we.preventDefault()
      this.send(encodeWheel(we.deltaX, we.deltaY))
    })
    // Keyboard is captured at the window level while the stream is focused.
    this.on('keydown', (e) => this.send(encodeKey(toKeysym(e as KeyboardEvent), true)), window)
    this.on('keyup', (e) => this.send(encodeKey(toKeysym(e as KeyboardEvent), false)), window)

    this.el.tabIndex = 0
  }

  private on(type: string, fn: EventListener, target: EventTarget = this.el): void {
    target.addEventListener(type, fn, { passive: false })
    this.listeners.push([type, fn])
    // remember target for cleanup
    ;(fn as unknown as { _t?: EventTarget })._t = target
  }

  detach(): void {
    for (const [type, fn] of this.listeners) {
      const target = (fn as unknown as { _t?: EventTarget })._t ?? this.el
      target.removeEventListener(type, fn)
    }
    this.listeners = []
  }
}
