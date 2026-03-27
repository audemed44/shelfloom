import { NavLink } from 'react-router-dom'
import { type LucideIcon } from 'lucide-react'
import { NAV_ITEMS, MORE_ITEMS } from './nav/navItems'

interface NavItemProps {
  to: string
  icon: LucideIcon
  label: string
  end?: boolean
}

function NavItem({ to, icon: Icon, label, end }: NavItemProps) {
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
  const sidebarItems = [...NAV_ITEMS, ...MORE_ITEMS]

  return (
    <aside
      className="hidden sm:flex w-20 lg:w-64 fixed top-0 left-0 h-full flex-col bg-black border-r border-white/10 z-40"
      data-testid="sidebar"
    >
      {/* Branding — icon-only on sm/md, full logo on lg+ */}
      <div className="flex items-center justify-center lg:justify-start p-4 lg:p-6 border-b border-white/10 lg:border-0">
        {/* Icon mark: always visible */}
        <div className="w-8 h-8 bg-primary flex items-center justify-center shrink-0 text-white font-black text-xs lg:hidden">
          S
        </div>
        {/* Full wordmark: lg+ only */}
        <div className="hidden lg:block">
          <h1 className="text-primary text-2xl font-black tracking-tighter leading-none">
            Shelfloom
          </h1>
        </div>
      </div>

      {/* Primary nav */}
      <nav className="flex-1 px-4 space-y-2 mt-4">
        {sidebarItems.map((item) => (
          <NavItem key={item.to} {...item} />
        ))}
      </nav>
    </aside>
  )
}
