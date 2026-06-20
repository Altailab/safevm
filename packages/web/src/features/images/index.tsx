import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { SafeVM } from '@/lib/safevm-api'
import { useIsAdmin } from '@/lib/use-auth'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
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

const schema = z.object({
  name: z.string().min(1, 'Required'),
  kernelRef: z.string().min(1, 'Required'),
  rootfsRef: z.string().min(1, 'Required'),
  description: z.string().optional(),
})

export function Images() {
  const qc = useQueryClient()
  const isAdmin = useIsAdmin()
  const [open, setOpen] = useState(false)
  const { data, isLoading } = useQuery({ queryKey: ['images'], queryFn: SafeVM.listImages })

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', kernelRef: '', rootfsRef: '', description: '' },
  })

  const create = useMutation({
    mutationFn: (input: z.infer<typeof schema>) => SafeVM.createImage(input),
    onSuccess: () => {
      toast.success('Image created')
      qc.invalidateQueries({ queryKey: ['images'] })
      qc.invalidateQueries({ queryKey: ['stats'] })
      setOpen(false)
      form.reset()
    },
    onError: () => toast.error('Could not create image'),
  })

  const fields = [
    { name: 'name' as const, label: 'Name', placeholder: 'debian-desktop' },
    { name: 'kernelRef' as const, label: 'Kernel ref', placeholder: 'images/debian/vmlinux' },
    { name: 'rootfsRef' as const, label: 'Rootfs ref', placeholder: 'images/debian/rootfs.ext4' },
    { name: 'description' as const, label: 'Description', placeholder: 'optional' },
  ]

  return (
    <PageShell
      title='Images'
      description='Golden OS templates that workspaces boot from.'
      actions={
        isAdmin ? (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className='size-4' /> New Image
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New Image</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form
                id='new-image'
                onSubmit={form.handleSubmit((v) => create.mutate(v))}
                className='grid gap-3'
              >
                {fields.map((f) => (
                  <FormField
                    key={f.name}
                    control={form.control}
                    name={f.name}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{f.label}</FormLabel>
                        <FormControl>
                          <Input placeholder={f.placeholder} {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                ))}
              </form>
            </Form>
            <DialogFooter>
              <Button type='submit' form='new-image' disabled={create.isPending}>
                {create.isPending ? 'Creating…' : 'Create'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        ) : null
      }
    >
      {isLoading ? (
        <Skeleton className='h-48 w-full' />
      ) : (
        <Card className='p-0'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Kernel</TableHead>
                <TableHead>Rootfs</TableHead>
                <TableHead>Description</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!data?.length ? (
                <TableRow>
                  <TableCell colSpan={4} className='text-muted-foreground text-center'>
                    No images yet.
                  </TableCell>
                </TableRow>
              ) : (
                data.map((img) => (
                  <TableRow key={img.id}>
                    <TableCell className='font-medium'>{img.name}</TableCell>
                    <TableCell className='font-mono text-xs'>{img.kernelRef}</TableCell>
                    <TableCell className='font-mono text-xs'>{img.rootfsRef}</TableCell>
                    <TableCell className='text-muted-foreground'>
                      {img.description ?? '—'}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
      )}
    </PageShell>
  )
}
