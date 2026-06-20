import type { StreamClient } from './types'
import { IframeStreamClient } from './iframe-client'
import { SelkiesStreamClient } from './selkies-client'

export type { StreamClient, StreamCapabilities } from './types'

export type StreamKind = 'iframe' | 'selkies'

// Factory. Today every session is the iframe tier; once the node-agent reports a
// stream kind per session (e.g. session.streamKind), pass it through here.
export function makeStreamClient(url: string, kind: StreamKind = 'iframe'): StreamClient {
  return kind === 'selkies' ? new SelkiesStreamClient(url) : new IframeStreamClient(url)
}

// Readiness probe: a container reports "running" the moment it starts, but the
// desktop's HTTP server takes a few more seconds. A no-cors fetch resolves once
// the port actually serves (opaque response) and rejects on connection refused —
// enough to know the desktop is reachable before we mount it.
export async function probeReady(url: string, timeoutMs = 2000): Promise<boolean> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    await fetch(url, { mode: 'no-cors', signal: ctrl.signal })
    return true
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}
