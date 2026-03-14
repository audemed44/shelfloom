import { NavLink } from 'react-router-dom'
import { Home, BookOpen, BarChart3, BookMarked, Settings } from 'lucide-react'

const NAV_ITEMS = [
  { to: '/', icon: Home, label: 'Home', end: true },
  { to: '/library', icon: BookOpen, label: 'Library' },
  { to: '/stats', icon: BarChart3, label: 'Stats' },
  { to: '/serials', icon: BookMarked, label: 'Serials' },
]

function NavItem({ to, icon: Icon, label, end }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
          isActive
            ? 'bg-blue-600/20 text-blue-400 border-l-2 border-blue-500'
            : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
        }`
      }
    >
      <Icon size={18} className="shrink-0" />
      <span className="hidden lg:block">{label}</span>
    </NavLink>
  )
}

export default function Sidebar() {
  return (
    <aside
      className="w-14 lg:w-52 flex flex-col shrink-0 bg-zinc-950 border-r border-zinc-800"
      data-testid="sidebar"
    >
      {/* Branding */}
      <div className="flex items-center gap-3 px-3 py-5 border-b border-zinc-800">
        <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center shrink-0">
          <BookMarked size={16} className="text-white" />
        </div>
        <span className="hidden lg:block font-bold text-xs tracking-widest text-blue-400 uppercase">
          Shelfloom
        </span>
      </div>

      {/* Primary nav */}
      <nav className="flex-1 py-4 flex flex-col gap-1 px-2">
        {NAV_ITEMS.map((item) => (
          <NavItem key={item.to} {...item} />
        ))}
      </nav>

      {/* Settings — pinned at bottom */}
      <div className="px-2 pb-4 pt-4 border-t border-zinc-800">
        <NavItem to="/settings" icon={Settings} label="Settings" />
      </div>
    </aside>
  )
}
