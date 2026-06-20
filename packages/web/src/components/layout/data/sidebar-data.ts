import {
  LayoutDashboard,
  Monitor,
  MonitorPlay,
  HardDrive,
  ScrollText,
  Users,
  Bot,
  ShieldCheck,
} from 'lucide-react'
import { type SidebarData } from '../types'

export const sidebarData: SidebarData = {
  user: {
    name: 'admin',
    email: 'admin@safevm.local',
    avatar: '/avatars/shadcn.jpg',
  },
  teams: [
    {
      name: 'SafeVM',
      logo: ShieldCheck,
      plan: 'Self-hosted',
    },
  ],
  navGroups: [
    {
      title: 'General',
      items: [
        { title: 'Dashboard', url: '/', icon: LayoutDashboard },
        { title: 'Workspaces', url: '/workspaces', icon: Monitor },
        { title: 'Agents', url: '/agents', icon: Bot },
        { title: 'Sessions', url: '/sessions', icon: MonitorPlay },
        { title: 'Images', url: '/images', icon: HardDrive, adminOnly: true },
        { title: 'Users', url: '/users', icon: Users, adminOnly: true },
        { title: 'Audit Log', url: '/audit', icon: ScrollText, adminOnly: true },
      ],
    },
  ],
}
