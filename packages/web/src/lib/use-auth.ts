import { useAuthStore } from '@/stores/auth-store'

type TokenPayload = {
  sub: string
  email: string
  role: string
  tenantId: string
  exp: number
}

function decode(token: string): TokenPayload | null {
  try {
    const [, payload] = token.split('.')
    return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')))
  } catch {
    return null
  }
}

// Derived from the JWT in the auth store: reactive (re-renders on login/logout)
// and survives refresh (the store hydrates the token from its cookie).
export function useTokenPayload(): TokenPayload | null {
  const token = useAuthStore((s) => s.auth.accessToken)
  return token ? decode(token) : null
}

export function useIsAdmin(): boolean {
  return useTokenPayload()?.role === 'admin'
}

export function useCurrentUser(): { email: string; role: string } | null {
  const p = useTokenPayload()
  return p ? { email: p.email, role: p.role } : null
}
