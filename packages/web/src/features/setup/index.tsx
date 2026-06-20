import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Globe, Loader2, Lock, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { SafeVM } from '@/lib/safevm-api'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PageShell } from '@/components/safevm/page-shell'

export function Setup() {
  const qc = useQueryClient()
  const { data: status, isLoading } = useQuery({
    queryKey: ['setup'],
    queryFn: SafeVM.getSetupStatus,
  })

  const [domain, setDomain] = useState('')
  const [email, setEmail] = useState('')

  const verify = useMutation({ mutationFn: () => SafeVM.verifyDns(domain.trim()) })
  const enable = useMutation({
    mutationFn: () => SafeVM.enableTls(domain.trim(), email.trim()),
    onSuccess: (r) => {
      toast.success('HTTPS enabled — switching to your secure URL…')
      setTimeout(() => (window.location.href = r.url), 1500)
    },
    onError: (e: unknown) => {
      const msg =
        (e as { response?: { data?: string } })?.response?.data ?? 'Failed to enable HTTPS'
      toast.error(typeof msg === 'string' ? msg : 'Failed to enable HTTPS')
    },
  })
  const skip = useMutation({
    mutationFn: () => SafeVM.skipSetup(),
    onSuccess: () => {
      toast.message('Setup dismissed — you can finish it anytime from here.')
      qc.invalidateQueries({ queryKey: ['setup'] })
    },
  })

  const dns = verify.data
  const dnsOk = !!dns?.matches

  if (isLoading) return <PageShell title='Setup'><Loader2 className='size-6 animate-spin' /></PageShell>

  if (status?.tlsEnabled) {
    return (
      <PageShell title='Setup' description='Your instance is configured.'>
        <Card className='max-w-xl'>
          <CardHeader>
            <CardTitle className='flex items-center gap-2'>
              <Lock className='size-5 text-green-600' /> HTTPS is active
            </CardTitle>
            <CardDescription>
              Served securely at{' '}
              <a className='font-medium underline' href={`https://${status.publicDomain}`}>
                https://{status.publicDomain}
              </a>{' '}
              with auto-renewing Let&apos;s Encrypt certificates. Desktops stream over this
              secure origin.
            </CardDescription>
          </CardHeader>
        </Card>
      </PageShell>
    )
  }

  return (
    <PageShell
      title='Finish setup'
      description='Point a domain at this server and enable HTTPS so desktops work securely.'
    >
      <div className='grid max-w-xl gap-4'>
        {/* Step 1 — domain + DNS */}
        <Card>
          <CardHeader>
            <CardTitle className='flex items-center gap-2'>
              <Globe className='size-5' /> 1 · Point your domain here
            </CardTitle>
            <CardDescription>
              In your DNS provider, create an <b>A record</b> for a subdomain pointing to this
              server&apos;s IP:
              <span className='bg-muted mx-1 rounded px-1.5 py-0.5 font-mono'>
                {status?.serverIp || '…'}
              </span>
            </CardDescription>
          </CardHeader>
          <CardContent className='space-y-3'>
            <div className='space-y-1.5'>
              <Label htmlFor='domain'>Domain</Label>
              <Input
                id='domain'
                placeholder='desktop.yourdomain.com'
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
              />
            </div>
            <Button
              variant='outline'
              disabled={!domain.trim() || verify.isPending}
              onClick={() => verify.mutate()}
            >
              {verify.isPending ? <Loader2 className='size-4 animate-spin' /> : null}
              Verify DNS
            </Button>
            {dns && (
              <p className='flex items-center gap-2 text-sm'>
                {dns.matches ? (
                  <>
                    <CheckCircle2 className='size-4 text-green-600' />
                    Resolves to this server ({dns.serverIp}).
                  </>
                ) : dns.resolves ? (
                  <>
                    <XCircle className='size-4 text-destructive' />
                    Points to {dns.addresses.join(', ')}, not this server ({dns.serverIp}). Fix the
                    A record.
                  </>
                ) : (
                  <>
                    <XCircle className='size-4 text-destructive' />
                    Doesn&apos;t resolve yet — add the A record and wait for DNS to propagate.
                  </>
                )}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Step 2 — HTTPS */}
        <Card className={dnsOk ? '' : 'opacity-60'}>
          <CardHeader>
            <CardTitle className='flex items-center gap-2'>
              <Lock className='size-5' /> 2 · Enable HTTPS
            </CardTitle>
            <CardDescription>
              Gets a free Let&apos;s Encrypt certificate (auto-renewed) and switches the dashboard
              and desktops to HTTPS. Requires ports 80 and 443 open.
            </CardDescription>
          </CardHeader>
          <CardContent className='space-y-3'>
            <div className='space-y-1.5'>
              <Label htmlFor='email'>Email (for renewal notices)</Label>
              <Input
                id='email'
                type='email'
                placeholder='you@yourdomain.com'
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <Button
              disabled={!dnsOk || !email.trim() || enable.isPending}
              onClick={() => enable.mutate()}
            >
              {enable.isPending ? <Loader2 className='size-4 animate-spin' /> : null}
              Enable HTTPS
            </Button>
            {enable.isPending && (
              <p className='text-muted-foreground text-sm'>
                Requesting certificate — this can take ~30s. The page will reload on the secure URL.
              </p>
            )}
          </CardContent>
        </Card>

        <button
          className='text-muted-foreground hover:text-foreground text-sm underline'
          onClick={() => skip.mutate()}
          disabled={skip.isPending}
        >
          Skip for now (continue on HTTP — desktops won&apos;t stream until HTTPS is set)
        </button>
      </div>
    </PageShell>
  )
}
