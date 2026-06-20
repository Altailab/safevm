import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { Bot, Square } from 'lucide-react'
import { toast } from 'sonner'
import { SafeVM } from '@/lib/safevm-api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { PageShell, StatusBadgeVariant } from '@/components/safevm/page-shell'

const schema = z.object({
  workspaceId: z.string().min(1, 'Pick a workspace'),
  goal: z.string().min(3, 'Describe the goal'),
})

function NewTaskDialog() {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const { data: workspaces } = useQuery({ queryKey: ['workspaces'], queryFn: SafeVM.listWorkspaces })

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { workspaceId: '', goal: '' },
  })

  const create = useMutation({
    mutationFn: (v: z.infer<typeof schema>) => SafeVM.createAgentTask(v),
    onSuccess: () => {
      toast.success('Agent task started')
      qc.invalidateQueries({ queryKey: ['agent-tasks'] })
      setOpen(false)
      form.reset()
    },
    onError: () => toast.error('Could not start agent task'),
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Bot className='size-4' /> New Agent Task
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Agent Task</DialogTitle>
          <DialogDescription>
            Give an AI agent a goal; it operates the workspace and records each step.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            id='new-agent-task'
            onSubmit={form.handleSubmit((v) => create.mutate(v))}
            className='grid gap-3'
          >
            <FormField
              control={form.control}
              name='workspaceId'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Workspace</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder='Select a workspace' />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {workspaces?.map((w) => (
                        <SelectItem key={w.id} value={w.id}>
                          {w.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='goal'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Goal</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder='e.g. Open the browser and download the latest invoice PDF'
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </form>
        </Form>
        <DialogFooter>
          <Button type='submit' form='new-agent-task' disabled={create.isPending}>
            {create.isPending ? 'Starting…' : 'Run agent'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function TaskDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient()
  const { data } = useQuery({
    queryKey: ['agent-task', id],
    queryFn: () => SafeVM.getAgentTask(id),
    refetchInterval: (q) => {
      const s = q.state.data?.status
      return s === 'running' || s === 'pending' ? 1000 : false
    },
  })

  const stop = useMutation({
    mutationFn: () => SafeVM.stopAgentTask(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agent-task', id] })
      qc.invalidateQueries({ queryKey: ['agent-tasks'] })
    },
  })

  const running = data?.status === 'running' || data?.status === 'pending'

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className='max-h-[80vh] overflow-hidden sm:max-w-2xl'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <Bot className='size-4' /> Agent trajectory
          </DialogTitle>
          <DialogDescription>{data?.goal}</DialogDescription>
        </DialogHeader>

        <div className='flex items-center gap-2'>
          {data && <Badge variant={StatusBadgeVariant(data.status)}>{data.status}</Badge>}
          <span className='text-muted-foreground text-xs'>model: {data?.model}</span>
          {running && (
            <Button
              size='sm'
              variant='destructive'
              className='ms-auto'
              disabled={stop.isPending}
              onClick={() => stop.mutate()}
            >
              <Square className='size-3' /> Stop
            </Button>
          )}
        </div>

        <div className='mt-2 max-h-[50vh] space-y-2 overflow-y-auto pe-1'>
          {!data?.steps?.length ? (
            <p className='text-muted-foreground text-sm'>Waiting for the first step…</p>
          ) : (
            data.steps.map((s) => (
              <div key={s.id} className='rounded-md border p-2 text-sm'>
                <div className='flex items-center gap-2'>
                  <span className='text-muted-foreground font-mono text-xs'>#{s.idx}</span>
                  <Badge variant='outline'>{s.actionType}</Badge>
                  {s.blocked && <Badge variant='destructive'>blocked</Badge>}
                </div>
                {s.thought && <p className='mt-1'>{s.thought}</p>}
                <p className='text-muted-foreground mt-1 font-mono text-xs'>
                  {JSON.stringify(s.action)}
                </p>
              </div>
            ))
          )}
        </div>

        {data?.result && (
          <p className='border-t pt-2 text-sm'>
            <span className='text-muted-foreground'>Result: </span>
            {data.result}
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}

export function Agents() {
  const [selected, setSelected] = useState<string | null>(null)
  const { data, isLoading } = useQuery({
    queryKey: ['agent-tasks'],
    queryFn: SafeVM.listAgentTasks,
    refetchInterval: 3000,
  })

  return (
    <PageShell
      title='Agents'
      description='AI agents that operate workspaces toward a goal — every step recorded.'
      actions={<NewTaskDialog />}
    >
      {isLoading ? (
        <Skeleton className='h-64 w-full' />
      ) : (
        <Card className='p-0'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Status</TableHead>
                <TableHead>Goal</TableHead>
                <TableHead>Workspace</TableHead>
                <TableHead>Model</TableHead>
                <TableHead>Started</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!data?.length ? (
                <TableRow>
                  <TableCell colSpan={5} className='text-muted-foreground text-center'>
                    No agent tasks yet — start one with “New Agent Task”.
                  </TableCell>
                </TableRow>
              ) : (
                data.map((t) => (
                  <TableRow
                    key={t.id}
                    className='cursor-pointer'
                    onClick={() => setSelected(t.id)}
                  >
                    <TableCell>
                      <Badge variant={StatusBadgeVariant(t.status)}>{t.status}</Badge>
                    </TableCell>
                    <TableCell className='max-w-sm truncate'>{t.goal}</TableCell>
                    <TableCell className='text-muted-foreground'>{t.workspace?.name ?? '—'}</TableCell>
                    <TableCell className='text-muted-foreground'>{t.model}</TableCell>
                    <TableCell className='text-muted-foreground'>
                      {new Date(t.createdAt).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
      )}

      {selected && <TaskDetail id={selected} onClose={() => setSelected(null)} />}
    </PageShell>
  )
}
