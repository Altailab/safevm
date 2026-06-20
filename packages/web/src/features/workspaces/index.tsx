import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { Monitor, Cpu, MemoryStick, ExternalLink, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { SafeVM, type Workspace } from '@/lib/safevm-api'
import { useIsAdmin } from '@/lib/use-auth'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
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
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { PageShell } from '@/components/safevm/page-shell'

const schema = z.object({
  name: z.string().min(1, 'Required'),
  imageId: z.string().min(1, 'Pick an image'),
  ownerId: z.string().min(1, 'Pick an owner'),
  kind: z.enum(['persistent', 'disposable']),
  vcpus: z.number().int().min(1).max(32),
  memMib: z.number().int().min(512),
})

function NewWorkspaceDialog() {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const { data: images } = useQuery({ queryKey: ['images'], queryFn: SafeVM.listImages })
  const { data: users } = useQuery({ queryKey: ['users'], queryFn: SafeVM.listUsers })

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', imageId: '', ownerId: '', kind: 'persistent', vcpus: 2, memMib: 2048 },
  })

  const create = useMutation({
    mutationFn: (v: z.infer<typeof schema>) => SafeVM.createWorkspace(v),
    onSuccess: () => {
      toast.success('Workspace created')
      qc.invalidateQueries({ queryKey: ['workspaces'] })
      qc.invalidateQueries({ queryKey: ['stats'] })
      setOpen(false)
      form.reset()
    },
    onError: () => toast.error('Could not create workspace'),
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className='size-4' /> New Workspace
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Workspace</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form
            id='new-workspace'
            onSubmit={form.handleSubmit((v) => create.mutate(v))}
            className='grid gap-3'
          >
            <FormField
              control={form.control}
              name='name'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input placeholder='Admin Desktop' {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='imageId'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Image</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder='Select an image' />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {images?.map((img) => (
                        <SelectItem key={img.id} value={img.id}>
                          {img.name}
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
              name='ownerId'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Owner</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder='Select an owner' />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {users?.map((u) => (
                        <SelectItem key={u.id} value={u.id}>
                          {u.email}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className='grid grid-cols-3 gap-3'>
              <FormField
                control={form.control}
                name='kind'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Kind</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value='persistent'>persistent</SelectItem>
                        <SelectItem value='disposable'>disposable</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='vcpus'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>vCPU</FormLabel>
                    <FormControl>
                      <Input
                        type='number'
                        {...field}
                        onChange={(e) => field.onChange(e.target.valueAsNumber)}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='memMib'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Mem (MiB)</FormLabel>
                    <FormControl>
                      <Input
                        type='number'
                        {...field}
                        onChange={(e) => field.onChange(e.target.valueAsNumber)}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
            </div>
          </form>
        </Form>
        <DialogFooter>
          <Button type='submit' form='new-workspace' disabled={create.isPending}>
            {create.isPending ? 'Creating…' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function Workspaces() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const isAdmin = useIsAdmin()
  const [launching, setLaunching] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['workspaces'],
    queryFn: SafeVM.listWorkspaces,
  })

  // Create the session, then open the in-app viewer which waits for the desktop
  // to become reachable before showing it (no premature new-tab open).
  const connect = useMutation({
    mutationFn: (ws: Workspace) => SafeVM.connect(ws.id),
    onMutate: (ws: Workspace) => setLaunching(ws.id),
    onSuccess: (s) => {
      qc.invalidateQueries({ queryKey: ['sessions'] })
      navigate({ to: '/sessions/$sessionId', params: { sessionId: s.id } })
    },
    onError: () => toast.error('Could not start session'),
    onSettled: () => setLaunching(null),
  })

  return (
    <PageShell
      title='Workspaces'
      description='Isolated desktops your users connect to from the browser.'
      actions={isAdmin ? <NewWorkspaceDialog /> : null}
    >
      {isLoading ? (
        <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3'>
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className='h-44 w-full' />
          ))}
        </div>
      ) : !data?.length ? (
        <Card>
          <CardHeader>
            <CardTitle>No workspaces yet</CardTitle>
            <CardDescription>Create one with “New Workspace”.</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3'>
          {data.map((ws) => (
            <Card key={ws.id} className='flex flex-col'>
              <CardHeader>
                <div className='flex items-center justify-between'>
                  <CardTitle className='flex items-center gap-2'>
                    <Monitor className='size-4' /> {ws.name}
                  </CardTitle>
                  <Badge variant={ws.kind === 'disposable' ? 'destructive' : 'secondary'}>
                    {ws.kind}
                  </Badge>
                </div>
                <CardDescription className='flex gap-4 pt-1'>
                  <span className='flex items-center gap-1'>
                    <Cpu className='size-3' /> {ws.vcpus} vCPU
                  </span>
                  <span className='flex items-center gap-1'>
                    <MemoryStick className='size-3' /> {ws.memMib} MiB
                  </span>
                </CardDescription>
              </CardHeader>
              <CardContent className='mt-auto'>
                <Button
                  className='w-full'
                  disabled={launching === ws.id}
                  onClick={() => connect.mutate(ws)}
                >
                  {launching === ws.id ? (
                    'Starting…'
                  ) : (
                    <>
                      <ExternalLink className='size-4' /> Connect
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </PageShell>
  )
}
