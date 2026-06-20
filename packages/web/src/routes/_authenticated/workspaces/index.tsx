import { createFileRoute } from '@tanstack/react-router'
import { Workspaces } from '@/features/workspaces'

export const Route = createFileRoute('/_authenticated/workspaces/')({
  component: Workspaces,
})
