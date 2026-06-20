import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Monitor, Square } from 'lucide-react'
import { toast } from 'sonner'
import { SafeVM } from '@/lib/safevm-api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { PageShell, StatusBadgeVariant } from '@/components/safevm/page-shell'
import { TablePagination } from '@/components/safevm/table-pagination'

const PAGE_SIZE = 10
const STATUSES = ['running', 'starting', 'pending', 'stopping', 'stopped', 'failed']
type SortKey = 'newest' | 'oldest' | 'status'

export function Sessions() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { data, isLoading } = useQuery({
    queryKey: ['sessions'],
    queryFn: SafeVM.listSessions,
    refetchInterval: 5000, // live-ish status
  })

  const stop = useMutation({
    mutationFn: (id: string) => SafeVM.stopSession(id),
    onSuccess: () => {
      toast.success('Stopping session')
      qc.invalidateQueries({ queryKey: ['sessions'] })
    },
    onError: () => toast.error('Failed to stop session'),
  })

  const active = (s: string) => s === 'running' || s === 'pending' || s === 'starting'

  const [statusFilter, setStatusFilter] = useState('all')
  const [sort, setSort] = useState<SortKey>('newest')
  const [page, setPage] = useState(0)

  const rows = useMemo(() => {
    let r = data ?? []
    if (statusFilter !== 'all') r = r.filter((s) => s.status === statusFilter)
    return [...r].sort((a, b) => {
      if (sort === 'status') return a.status.localeCompare(b.status)
      const diff = +new Date(b.startedAt) - +new Date(a.startedAt)
      return sort === 'newest' ? diff : -diff
    })
  }, [data, statusFilter, sort])

  // Reset to the first page when filters change or the dataset shrinks.
  useEffect(() => {
    setPage(0)
  }, [statusFilter, sort])
  useEffect(() => {
    const last = Math.max(0, Math.ceil(rows.length / PAGE_SIZE) - 1)
    if (page > last) setPage(last)
  }, [rows.length, page])

  const pageRows = rows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)

  return (
    <PageShell title='Sessions' description='Running and historical workspace sessions.'>
      {isLoading ? (
        <Skeleton className='h-64 w-full' />
      ) : (
        <>
          <div className='mb-3 flex flex-wrap items-center gap-2'>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className='w-[170px]'>
                <SelectValue placeholder='Filter status' />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='all'>All statuses</SelectItem>
                {STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
              <SelectTrigger className='w-[170px]'>
                <SelectValue placeholder='Sort by' />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='newest'>Newest first</SelectItem>
                <SelectItem value='oldest'>Oldest first</SelectItem>
                <SelectItem value='status'>Status</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Card className='p-0'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>Session</TableHead>
                  <TableHead>Node</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead className='text-right'>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!rows.length ? (
                  <TableRow>
                    <TableCell colSpan={5} className='text-muted-foreground text-center'>
                      {data?.length
                        ? 'No sessions match the current filter.'
                        : 'No sessions yet — connect to a workspace to start one.'}
                    </TableCell>
                  </TableRow>
                ) : (
                  pageRows.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell>
                        <Badge variant={StatusBadgeVariant(s.status)}>{s.status}</Badge>
                      </TableCell>
                      <TableCell className='font-mono text-xs'>{s.id.slice(0, 8)}</TableCell>
                      <TableCell className='text-muted-foreground'>{s.nodeId ?? '—'}</TableCell>
                      <TableCell className='text-muted-foreground'>
                        {new Date(s.startedAt).toLocaleString()}
                      </TableCell>
                      <TableCell className='flex justify-end gap-2'>
                        {active(s.status) && (
                          <Button
                            size='sm'
                            variant='outline'
                            onClick={() =>
                              navigate({ to: '/sessions/$sessionId', params: { sessionId: s.id } })
                            }
                          >
                            <Monitor className='size-3' /> Open
                          </Button>
                        )}
                        {active(s.status) && (
                          <Button
                            size='sm'
                            variant='destructive'
                            disabled={stop.isPending}
                            onClick={() => stop.mutate(s.id)}
                          >
                            <Square className='size-3' /> Stop
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
            {rows.length > 0 && (
              <TablePagination
                page={page}
                pageSize={PAGE_SIZE}
                total={rows.length}
                onPageChange={setPage}
              />
            )}
          </Card>
        </>
      )}
    </PageShell>
  )
}
