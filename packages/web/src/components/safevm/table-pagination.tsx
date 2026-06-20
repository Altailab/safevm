import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'

// Lightweight client-side pagination footer for the admin tables.
export function TablePagination({
  page,
  pageSize,
  total,
  onPageChange,
}: {
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const from = total === 0 ? 0 : page * pageSize + 1
  const to = Math.min(total, (page + 1) * pageSize)

  return (
    <div className='flex items-center justify-between gap-4 px-4 py-3'>
      <p className='text-muted-foreground text-sm'>
        {total === 0 ? 'No results' : `Showing ${from}–${to} of ${total}`}
      </p>
      <div className='flex items-center gap-2'>
        <span className='text-muted-foreground text-sm'>
          Page {page + 1} of {pageCount}
        </span>
        <Button
          size='icon'
          variant='outline'
          className='size-8'
          disabled={page <= 0}
          onClick={() => onPageChange(page - 1)}
          aria-label='Previous page'
        >
          <ChevronLeft className='size-4' />
        </Button>
        <Button
          size='icon'
          variant='outline'
          className='size-8'
          disabled={page >= pageCount - 1}
          onClick={() => onPageChange(page + 1)}
          aria-label='Next page'
        >
          <ChevronRight className='size-4' />
        </Button>
      </div>
    </div>
  )
}
