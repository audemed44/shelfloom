import { NavLink } from 'react-router-dom'
import { Settings } from 'lucide-react'
import { NAV_ITEMS } from './nav/navItems'

const NAV_LINK_CLASS = ({ isActive }: { isActive: boolean }) =>
  `flex flex-col items-center gap-1 py-3 px-4 text-[9px] font-black tracking-widest transition-colors ${
    isActive ? 'text-primary' : 'text-white/40'
  }`

export default function BottomNav() {
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 sm:hidden bg-black border-t border-white/10 z-40"
      data-testid="bottom-nav"
    >
      <div className="flex items-center justify-around safe-area-pb">
        {NAV_ITEMS.map(({ to, icon: Icon, label, end }) => (
          <NavLink key={to} to={to} end={end} className={NAV_LINK_CLASS}>
            <Icon size={22} />
            <span>{label}</span>
          </NavLink>
        ))}
        <NavLink to="/settings" className={NAV_LINK_CLASS}>
          <Settings size={22} />
          <span>Settings</span>
        </NavLink>
      </div>
    </nav>
  )
}
