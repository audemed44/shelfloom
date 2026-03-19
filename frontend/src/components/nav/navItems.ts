import {
  Home,
  BookOpen,
  BarChart3,
  BookMarked,
  Scroll,
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
  { to: '/stats', icon: BarChart3, label: 'Stats' },
  { to: '/series', icon: BookMarked, label: 'Series' },
  { to: '/serials', icon: Scroll, label: 'Serials' },
]
