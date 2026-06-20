import { createFileRoute } from '@tanstack/react-router'
import { Images } from '@/features/images'

export const Route = createFileRoute('/_authenticated/images/')({
  component: Images,
})
