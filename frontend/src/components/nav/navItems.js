import { Home, BookOpen, BarChart3, BookMarked } from 'lucide-react'

export const NAV_ITEMS = [
  { to: '/', icon: Home, label: 'Home', end: true },
  { to: '/library', icon: BookOpen, label: 'Library' },
  { to: '/stats', icon: BarChart3, label: 'Stats' },
  { to: '/serials', icon: BookMarked, label: 'Serials' },
]
