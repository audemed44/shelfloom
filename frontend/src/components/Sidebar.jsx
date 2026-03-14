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
        `flex items-center gap-4 px-4 py-3 rounded transition-colors ${
          isActive
            ? 'bg-primary text-white'
            : 'text-white/60 hover:text-white hover:bg-white/5'
        }`
      }
    >
      <Icon size={20} className="shrink-0" />
      <span className="hidden lg:block font-bold text-xs tracking-widest">
        {label}
      </span>
    </NavLink>
  )
}

export default function Sidebar() {
  return (
    <aside
      className="w-20 lg:w-64 border-r border-white/10 flex flex-col shrink-0 bg-black"
      data-testid="sidebar"
    >
      {/* Branding */}
      <div className="p-6">
        <h1 className="text-primary text-2xl font-black tracking-tighter leading-none">
          Shelfloom
        </h1>
        <p className="text-white/40 text-[10px] font-bold tracking-[0.2em] mt-1">
          OLED Edition
        </p>
      </div>

      {/* Primary nav */}
      <nav className="flex-1 px-4 space-y-2 mt-4">
        {NAV_ITEMS.map((item) => (
          <NavItem key={item.to} {...item} />
        ))}
      </nav>

      {/* Settings — pinned at bottom */}
      <div className="p-4 mt-auto border-t border-white/10">
        <NavItem to="/settings" icon={Settings} label="Settings" />
      </div>
    </aside>
  )
}
