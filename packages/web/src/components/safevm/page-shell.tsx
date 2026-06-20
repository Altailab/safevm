import { type ReactNode } from 'react'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'

type PageShellProps = {
  title: string
  description?: string
  actions?: ReactNode
  children: ReactNode
}

// Consistent page chrome for SafeVM admin pages: top header + titled main area.
export function PageShell({ title, description, actions, children }: PageShellProps) {
  return (
    <>
      <Header>
        <div className='ms-auto flex items-center gap-2'>
          <ThemeSwitch />
          <ProfileDropdown />
        </div>
      </Header>
      <Main>
        <div className='mb-4 flex items-end justify-between gap-4'>
          <div>
            <h1 className='text-2xl font-bold tracking-tight'>{title}</h1>
            {description && (
              <p className='text-muted-foreground text-sm'>{description}</p>
            )}
          </div>
          {actions && <div className='flex items-center gap-2'>{actions}</div>}
        </div>
        {children}
      </Main>
    </>
  )
}

export function StatusBadgeVariant(status: string) {
  switch (status) {
    case 'running':
      return 'default'
    case 'pending':
    case 'starting':
    case 'stopping':
      return 'secondary'
    case 'failed':
      return 'destructive'
    default:
      return 'outline'
  }
}
