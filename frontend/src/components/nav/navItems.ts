import {
  Home,
  BookOpen,
  Scroll,
  Telescope,
  BookMarked,
  BarChart3,
  Settings,
  MoreHorizontal,
  type LucideIcon,
} from 'lucide-react'

export interface NavItem {
  to: string
  icon: LucideIcon
  label: string
  end?: boolean
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', icon: Home, label: 'Home', end: true },
  { to: '/library', icon: BookOpen, label: 'Library' },
  { to: '/serials', icon: Scroll, label: 'Serials' },
  { to: '/lenses', icon: Telescope, label: 'Lenses' },
]

export const MORE_ITEMS: NavItem[] = [
  { to: '/series', icon: BookMarked, label: 'Series' },
  { to: '/stats', icon: BarChart3, label: 'Stats' },
  { to: '/settings', icon: Settings, label: 'Settings' },
]

export { MoreHorizontal }
