import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { SafeVM } from '@/lib/safevm-api'
import { SessionViewer } from '@/components/safevm/session-viewer'

export const Route = createFileRoute('/_authenticated/sessions/$sessionId')({
  component: ViewerRoute,
})

function ViewerRoute() {
  const { sessionId } = Route.useParams()

  // Poll the session until the agent reports a connectUrl (or it ends).
  const { data: session } = useQuery({
    queryKey: ['session', sessionId],
    queryFn: () => SafeVM.getSession(sessionId),
    refetchInterval: (q) => {
      const s = q.state.data
      if (!s) return 1500
      return s.connectUrl || s.status === 'failed' || s.status === 'stopped' ? false : 1500
    },
  })
  const { data: workspaces } = useQuery({
    queryKey: ['workspaces'],
    queryFn: SafeVM.listWorkspaces,
  })

  if (!session) {
    return (
      <div className='flex h-[60vh] items-center justify-center'>
        <Loader2 className='size-6 animate-spin' />
      </div>
    )
  }

  if (session.status === 'failed' || session.status === 'stopped') {
    return (
      <div className='flex h-[60vh] flex-col items-center justify-center gap-2'>
        <p className='text-lg font-medium'>Session {session.status}</p>
        <p className='text-muted-foreground text-sm'>This session is no longer available.</p>
      </div>
    )
  }

  const workspace = workspaces?.find((w) => w.id === session.workspaceId)
  return <SessionViewer session={session} workspace={workspace} />
}
