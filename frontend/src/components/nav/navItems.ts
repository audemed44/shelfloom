import { Home, BookOpen, BarChart3, BookMarked, type LucideIcon } from 'lucide-react'

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
  { to: '/serials', icon: BookMarked, label: 'Serials' },
]
