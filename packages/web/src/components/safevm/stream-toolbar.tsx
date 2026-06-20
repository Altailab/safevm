import { useRef, useState } from 'react'
import { ChevronDown, ChevronUp, GripVertical, ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

export interface ToolbarItem {
  key: string
  icon: React.ElementType
  label: string
  onClick?: () => void
  disabled?: boolean
  disabledReason?: string
  variant?: 'ghost' | 'destructive'
}

// A draggable, collapsible floating widget overlaid on the live stream. Native
// SafeVM controls — works over the iframe tier and the WebRTC <video> tier alike.
export function StreamToolbar({
  items,
  title,
  status,
}: {
  items: ToolbarItem[]
  title?: string
  status?: string
}) {
  const [pos, setPos] = useState({ x: 16, y: 12 })
  const [open, setOpen] = useState(true)
  const drag = useRef<{ dx: number; dy: number } | null>(null)

  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return
    setPos({ x: Math.max(0, e.clientX - drag.current.dx), y: Math.max(0, e.clientY - drag.current.dy) })
  }
  const onPointerUp = () => {
    drag.current = null
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div
        className='bg-background/90 absolute z-20 flex items-center gap-1 rounded-full border px-1.5 py-1 shadow-lg backdrop-blur'
        style={{ left: pos.x, top: pos.y }}
      >
        {/* Drag handle */}
        <div
          className='flex cursor-grab items-center gap-1 ps-1 pe-1 active:cursor-grabbing'
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          <ShieldCheck className='size-4' />
          <GripVertical className='text-muted-foreground size-3.5' />
        </div>

        {title && <span className='max-w-[10rem] truncate text-xs font-medium'>{title}</span>}
        {status && (
          <Badge variant={status === 'connected' ? 'default' : 'secondary'} className='h-5'>
            {status}
          </Badge>
        )}

        <Button
          size='icon'
          variant='ghost'
          className='size-7'
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? 'Collapse toolbar' : 'Expand toolbar'}
        >
          {open ? <ChevronUp className='size-4' /> : <ChevronDown className='size-4' />}
        </Button>

        <div className={cn('flex items-center gap-0.5', !open && 'hidden')}>
          {items.map((it) => (
            <Tooltip key={it.key}>
              <TooltipTrigger asChild>
                <span>
                  <Button
                    size='icon'
                    variant={it.variant ?? 'ghost'}
                    className='size-7'
                    disabled={it.disabled}
                    onClick={it.onClick}
                  >
                    <it.icon className='size-4' />
                    <span className='sr-only'>{it.label}</span>
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {it.disabled && it.disabledReason ? it.disabledReason : it.label}
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
      </div>
    </TooltipProvider>
  )
}
