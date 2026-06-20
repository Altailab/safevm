import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import {
  ArrowLeft,
  Clipboard,
  Copy,
  ExternalLink,
  Expand,
  FileUp,
  Loader2,
  PowerOff,
  ShieldAlert,
  Bot,
} from 'lucide-react'
import { toast } from 'sonner'
import { SafeVM, type Session, type Workspace } from '@/lib/safevm-api'
import {
  makeStreamClient,
  probeReady,
  type StreamCapabilities,
  type StreamClient,
  type StreamKind,
} from '@/lib/stream'
import { StreamToolbar, type ToolbarItem } from '@/components/safevm/stream-toolbar'

type Phase = 'connecting' | 'starting' | 'ready'

// iframe tier by default; `?stream=selkies` selects the WebRTC tier (needs a
// Selkies-enabled workspace image whose connectUrl is the signalling WS URL).
function currentStreamKind(): StreamKind {
  return new URLSearchParams(window.location.search).get('stream') === 'selkies'
    ? 'selkies'
    : 'iframe'
}

export function SessionViewer({
  session,
  workspace,
}: {
  session: Session
  workspace?: Workspace
}) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const stageRef = useRef<HTMLDivElement>(null)
  const clientRef = useRef<StreamClient | null>(null)
  const [phase, setPhase] = useState<Phase>('connecting')
  const url = session.connectUrl ?? ''
  const kind = currentStreamKind()

  useEffect(() => {
    if (!url || !stageRef.current) return
    let cancelled = false
    const client = makeStreamClient(url, kind)
    clientRef.current = client

    ;(async () => {
      setPhase('starting')
      // HTTP tier: probe until the desktop serves. WebRTC tier negotiates itself.
      if (kind === 'iframe') {
        for (let i = 0; i < 60 && !cancelled; i++) {
          if (await probeReady(url)) break
          await new Promise((r) => setTimeout(r, 1000))
        }
      }
      if (cancelled || !stageRef.current) return
      try {
        await client.attach(stageRef.current)
        setPhase('ready')
      } catch (e) {
        toast.error(`Stream failed: ${(e as Error).message}`)
      }
    })()

    return () => {
      cancelled = true
      client.detach()
      clientRef.current = null
    }
  }, [url, kind])

  const stop = useMutation({
    mutationFn: () => SafeVM.stopSession(session.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sessions'] })
      toast.success('Disconnected')
      navigate({ to: '/workspaces' })
    },
  })

  const caps = clientRef.current?.capabilities
  const policy = (workspace?.policy ?? {}) as Record<string, boolean>
  const gated = (cap: keyof StreamCapabilities) => ({
    disabled: !caps?.[cap] || !policy[cap],
    disabledReason: !caps?.[cap]
      ? 'Available on the Selkies (WebRTC) tier'
      : 'Disabled by workspace policy',
  })

  const items: ToolbarItem[] = [
    { key: 'back', icon: ArrowLeft, label: 'Back to workspaces', onClick: () => navigate({ to: '/workspaces' }) },
    {
      key: 'clipboard',
      icon: Clipboard,
      label: 'Sync clipboard',
      ...gated('clipboard'),
      onClick: () => clientRef.current?.getClipboard?.(),
    },
    {
      key: 'upload',
      icon: FileUp,
      label: 'Upload file',
      ...gated('fileTransfer'),
      onClick: () => toast.info('File transfer arrives with the Selkies tier'),
    },
    {
      key: 'sandbox',
      icon: ShieldAlert,
      label: 'Open in sandbox',
      disabled: true,
      disabledReason: 'Disposable detonation sandbox — Phase 2',
    },
    {
      key: 'agent',
      icon: Bot,
      label: 'Hand to agent',
      disabled: true,
      disabledReason: 'Co-pilot take-over — agent track',
    },
    {
      key: 'copy',
      icon: Copy,
      label: 'Copy link',
      onClick: () => {
        navigator.clipboard.writeText(url)
        toast.success('Connect link copied')
      },
    },
    { key: 'newtab', icon: ExternalLink, label: 'Open in new tab', onClick: () => window.open(url, '_blank', 'noopener') },
    {
      key: 'fullscreen',
      icon: Expand,
      label: 'Fullscreen',
      onClick: () => stageRef.current && clientRef.current?.fullscreen(stageRef.current),
    },
    {
      key: 'disconnect',
      icon: PowerOff,
      label: 'Disconnect',
      variant: 'destructive',
      disabled: stop.isPending,
      onClick: () => stop.mutate(),
    },
  ]

  return (
    <div className='relative h-[calc(100svh-3rem)] overflow-hidden bg-black'>
      <div ref={stageRef} className='absolute inset-0' />

      <StreamToolbar
        items={items}
        title={workspace?.name ?? 'Workspace'}
        status={phase === 'ready' ? 'connected' : phase}
      />

      {phase !== 'ready' && (
        <div className='pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 text-white/80'>
          <Loader2 className='size-8 animate-spin' />
          <p className='text-sm'>
            {phase === 'connecting'
              ? 'Provisioning session…'
              : kind === 'selkies'
                ? 'Negotiating WebRTC stream…'
                : 'Starting desktop — waiting for it to come up…'}
          </p>
        </div>
      )}
    </div>
  )
}
