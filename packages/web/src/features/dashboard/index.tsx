import { useQuery } from '@tanstack/react-query'
import { Monitor, MonitorPlay, HardDrive, Users, Activity } from 'lucide-react'
import { SafeVM } from '@/lib/safevm-api'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { PageShell } from '@/components/safevm/page-shell'

const cards = [
  { key: 'workspaces', label: 'Workspaces', icon: Monitor },
  { key: 'runningSessions', label: 'Running sessions', icon: Activity },
  { key: 'totalSessions', label: 'Total sessions', icon: MonitorPlay },
  { key: 'images', label: 'Images', icon: HardDrive },
  { key: 'users', label: 'Users', icon: Users },
] as const

export function Dashboard() {
  const { data, isLoading } = useQuery({
    queryKey: ['stats'],
    queryFn: SafeVM.stats,
    refetchInterval: 5000,
  })

  return (
    <PageShell
      title='Dashboard'
      description='Overview of your SafeVM deployment.'
    >
      <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-5'>
        {cards.map(({ key, label, icon: Icon }) =>
          isLoading ? (
            <Skeleton key={key} className='h-28 w-full' />
          ) : (
            <Card key={key}>
              <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
                <CardTitle className='text-sm font-medium'>{label}</CardTitle>
                <Icon className='text-muted-foreground size-4' />
              </CardHeader>
              <CardContent>
                <div className='text-2xl font-bold'>{data?.[key] ?? 0}</div>
              </CardContent>
            </Card>
          )
        )}
      </div>
    </PageShell>
  )
}
