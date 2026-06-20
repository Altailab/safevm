import axios from 'axios'
import { getCookie } from '@/lib/cookies'

const ACCESS_TOKEN = 'thisisjustarandomstring'

// SafeVM control-plane client. Same-origin in production (nginx proxies /api),
// so the dashboard works on http://ip OR https://domain with no rebuild. Falls
// back to the local API only during `vite dev`.
export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? 'http://localhost:3001' : ''),
})

// Attach the JWT (stored by the auth store as a JSON-encoded cookie) to every request.
api.interceptors.request.use((config) => {
  const raw = getCookie(ACCESS_TOKEN)
  const token = raw ? JSON.parse(raw) : ''
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

export type WorkspaceKind = 'persistent' | 'disposable'

export type SessionStatus =
  | 'pending'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'stopped'
  | 'failed'

export interface Workspace {
  id: string
  tenantId: string
  ownerId: string
  imageId: string
  name: string
  kind: WorkspaceKind
  vcpus: number
  memMib: number
  policy: Record<string, unknown>
  createdAt: string
}

export interface Session {
  id: string
  tenantId: string
  workspaceId: string
  userId: string
  nodeId: string | null
  status: SessionStatus
  connectUrl: string | null
  startedAt: string
  endedAt: string | null
}

export interface Image {
  id: string
  name: string
  kernelRef: string
  rootfsRef: string
  description: string | null
  createdAt: string
}

export interface User {
  id: string
  email: string
  role: string
  createdAt: string
}

export interface AuditLog {
  id: string
  actorId: string | null
  action: string
  target: string | null
  meta: Record<string, unknown>
  createdAt: string
}

export interface Stats {
  workspaces: number
  images: number
  users: number
  runningSessions: number
  totalSessions: number
}

export type AgentTaskStatus =
  | 'pending'
  | 'running'
  | 'awaiting_approval'
  | 'succeeded'
  | 'failed'
  | 'stopped'

export interface AgentStep {
  id: string
  idx: number
  thought: string | null
  actionType: string
  action: Record<string, unknown>
  observation: string | null
  blocked: boolean
  createdAt: string
}

export interface AgentTask {
  id: string
  workspaceId: string
  goal: string
  status: AgentTaskStatus
  model: string
  maxSteps: number
  result: string | null
  createdAt: string
  endedAt: string | null
  workspace?: { name: string }
  steps?: AgentStep[]
}

export interface AuthUser {
  id: string
  email: string
  role: string
}

export const SafeVM = {
  login: (email: string, password: string) =>
    api
      .post<{ token: string; user: AuthUser }>('/api/auth/login', { email, password })
      .then((r) => r.data),
  me: () => api.get<AuthUser>('/api/auth/me').then((r) => r.data),
  listWorkspaces: () => api.get<Workspace[]>('/api/workspaces').then((r) => r.data),
  createWorkspace: (input: {
    name: string
    imageId: string
    ownerId: string
    kind?: WorkspaceKind
    vcpus?: number
    memMib?: number
  }) => api.post<Workspace>('/api/workspaces', input).then((r) => r.data),
  connect: (id: string) =>
    api.post<Session>(`/api/workspaces/${id}/connect`).then((r) => r.data),
  listSessions: () => api.get<Session[]>('/api/sessions').then((r) => r.data),
  getSession: (id: string) =>
    api.get<Session>(`/api/sessions/${id}`).then((r) => r.data),
  stopSession: (id: string) =>
    api.post(`/api/sessions/${id}/stop`).then((r) => r.data),
  listImages: () => api.get<Image[]>('/api/images').then((r) => r.data),
  createImage: (input: {
    name: string
    kernelRef: string
    rootfsRef: string
    description?: string
  }) => api.post<Image>('/api/images', input).then((r) => r.data),
  listUsers: () => api.get<User[]>('/api/users').then((r) => r.data),
  createUser: (input: { email: string; password: string; role?: 'admin' | 'member' }) =>
    api.post<User>('/api/users', input).then((r) => r.data),
  listAudit: () => api.get<AuditLog[]>('/api/audit').then((r) => r.data),
  stats: () => api.get<Stats>('/api/stats').then((r) => r.data),
  listAgentTasks: () => api.get<AgentTask[]>('/api/agent-tasks').then((r) => r.data),
  getAgentTask: (id: string) =>
    api.get<AgentTask>(`/api/agent-tasks/${id}`).then((r) => r.data),
  createAgentTask: (input: { workspaceId: string; goal: string; maxSteps?: number }) =>
    api.post<AgentTask>('/api/agent-tasks', input).then((r) => r.data),
  stopAgentTask: (id: string) =>
    api.post(`/api/agent-tasks/${id}/stop`).then((r) => r.data),
  getSetupStatus: () => api.get<SetupStatus>('/api/setup/status').then((r) => r.data),
  verifyDns: (domain: string) =>
    api.post<DnsCheck>('/api/setup/verify-dns', { domain }).then((r) => r.data),
  enableTls: (domain: string, email: string) =>
    api.post<{ ok: boolean; url: string }>('/api/setup/enable-tls', { domain, email }).then((r) => r.data),
  skipSetup: () => api.post('/api/setup/skip').then((r) => r.data),
}

export type SetupStatus = {
  setupDone: boolean
  tlsEnabled: boolean
  publicDomain: string | null
  serverIp: string
}

export type DnsCheck = {
  domain: string
  serverIp: string
  addresses: string[]
  resolves: boolean
  matches: boolean
}
