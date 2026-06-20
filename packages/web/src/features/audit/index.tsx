import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { SafeVM } from '@/lib/safevm-api'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { PageShell } from '@/components/safevm/page-shell'
import { TablePagination } from '@/components/safevm/table-pagination'

const PAGE_SIZE = 10

export function Audit() {
  const { data, isLoading } = useQuery({
    queryKey: ['audit'],
    queryFn: SafeVM.listAudit,
    refetchInterval: 10000,
  })

  const [page, setPage] = useState(0)
  const rows = data ?? []
  // Clamp the page if the dataset shrinks (e.g. after a refetch).
  useEffect(() => {
    const last = Math.max(0, Math.ceil(rows.length / PAGE_SIZE) - 1)
    if (page > last) setPage(last)
  }, [rows.length, page])
  const pageRows = rows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)

  return (
    <PageShell
      title='Audit Log'
      description='Every meaningful action, recorded for accountability.'
    >
      {isLoading ? (
        <Skeleton className='h-64 w-full' />
      ) : (
        <Card className='p-0'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Action</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>When</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!rows.length ? (
                <TableRow>
                  <TableCell colSpan={3} className='text-muted-foreground text-center'>
                    No audit entries yet.
                  </TableCell>
                </TableRow>
              ) : (
                pageRows.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>
                      <Badge variant='outline'>{a.action}</Badge>
                    </TableCell>
                    <TableCell className='font-mono text-xs'>
                      {a.target ? a.target.slice(0, 8) : '—'}
                    </TableCell>
                    <TableCell className='text-muted-foreground'>
                      {new Date(a.createdAt).toLocaleString()}
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
      )}
    </PageShell>
  )
}
