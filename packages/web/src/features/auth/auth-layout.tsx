import { Logo } from '@/assets/logo'

type AuthLayoutProps = {
  children: React.ReactNode
}

export function AuthLayout({ children }: AuthLayoutProps) {
  return (
    <div className='container grid h-svh max-w-none items-center justify-center'>
      <div className='mx-auto flex w-full flex-col justify-center space-y-2 py-8 sm:p-8'>
        <div className='mb-4 flex items-center justify-center'>
          <Logo className='me-2' />
          <h1 className='text-xl font-medium'>SafeVM</h1>
        </div>
        {children}
        <p className='text-muted-foreground pt-4 text-center text-xs'>
          A product of{' '}
          <a
            href='https://altailab.com'
            target='_blank'
            rel='noreferrer'
            className='font-medium underline-offset-4 hover:underline'
          >
            Altailab LLC
          </a>
        </p>
      </div>
    </div>
  )
}
