import { useLayout } from '@/context/layout-provider'
import { useCurrentUser, useIsAdmin } from '@/lib/use-auth'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from '@/components/ui/sidebar'
// import { AppTitle } from './app-title'
import { sidebarData } from './data/sidebar-data'
import { NavGroup } from './nav-group'
import { NavUser } from './nav-user'
import { TeamSwitcher } from './team-switcher'

export function AppSidebar() {
  const { collapsible, variant } = useLayout()
  const isAdmin = useIsAdmin()
  const currentUser = useCurrentUser()

  // Hide admin-only nav entries from non-admin members.
  const navGroups = sidebarData.navGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => isAdmin || !item.adminOnly),
    }))
    .filter((group) => group.items.length > 0)

  const user = currentUser
    ? {
        name: currentUser.email.split('@')[0],
        email: currentUser.email,
        avatar: sidebarData.user.avatar,
      }
    : sidebarData.user

  return (
    <Sidebar collapsible={collapsible} variant={variant}>
      <SidebarHeader>
        <TeamSwitcher teams={sidebarData.teams} />
      </SidebarHeader>
      <SidebarContent>
        {navGroups.map((props) => (
          <NavGroup key={props.title} {...props} />
        ))}
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} />
        <div className='text-muted-foreground px-2 pb-1 text-center text-[10px] group-data-[collapsible=icon]:hidden'>
          A product of{' '}
          <a
            href='https://altailab.com'
            target='_blank'
            rel='noreferrer'
            className='font-medium hover:underline'
          >
            Altailab LLC
          </a>
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
