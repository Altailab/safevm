import { createFileRoute } from '@tanstack/react-router'
import { Setup } from '@/features/setup'

export const Route = createFileRoute('/_authenticated/setup/')({
  component: Setup,
})
