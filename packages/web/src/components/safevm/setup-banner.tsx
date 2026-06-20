import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { TriangleAlert } from 'lucide-react'
import { SafeVM } from '@/lib/safevm-api'
import { useIsAdmin } from '@/lib/use-auth'

// Nudges admins to finish domain + HTTPS setup until it's done. Hidden for
// members and once TLS is configured (or the wizard is dismissed).
export function SetupBanner() {
  const isAdmin = useIsAdmin()
  const { data } = useQuery({
    queryKey: ['setup'],
    queryFn: SafeVM.getSetupStatus,
    enabled: isAdmin,
  })
  if (!isAdmin || !data || data.setupDone || data.tlsEnabled) return null
  return (
    <div className='flex items-center justify-between gap-4 border-b bg-amber-500/15 px-4 py-2 text-sm text-amber-900 dark:text-amber-200'>
      <span className='flex items-center gap-2'>
        <TriangleAlert className='size-4 shrink-0' />
        Finish setup — point a domain at this server and enable HTTPS so desktops can stream.
      </span>
      <Link to='/setup' className='font-medium whitespace-nowrap underline'>
        Open setup →
      </Link>
    </div>
  )
}
