import { useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { NAV_ITEMS, MORE_ITEMS, MoreHorizontal } from './nav/navItems'
import MoreMenu from './nav/MoreMenu'

const NAV_LINK_CLASS = ({ isActive }: { isActive: boolean }) =>
  `flex flex-col items-center gap-1 py-3 px-4 text-[9px] font-black tracking-widest transition-colors ${
    isActive ? 'text-primary' : 'text-white/40'
  }`

export default function BottomNav() {
  const [moreOpen, setMoreOpen] = useState(false)
  const location = useLocation()
  const moreActive = MORE_ITEMS.some((item) =>
    location.pathname.startsWith(item.to)
  )

  return (
    <>
      <nav
        className="fixed inset-x-0 bottom-0 z-50 border-t border-white/10 bg-black/95 backdrop-blur-md sm:hidden"
        data-testid="bottom-nav"
      >
        <div className="flex items-center justify-around safe-area-pb">
          {NAV_ITEMS.map(({ to, icon: Icon, label, end }) => (
            <NavLink key={to} to={to} end={end} className={NAV_LINK_CLASS}>
              <Icon size={22} />
              <span>{label}</span>
            </NavLink>
          ))}
          <button
            onClick={() => setMoreOpen((o) => !o)}
            className={`flex flex-col items-center gap-1 py-3 px-4 text-[9px] font-black tracking-widest transition-colors ${
              moreActive || moreOpen ? 'text-primary' : 'text-white/40'
            }`}
            aria-label="More"
            data-testid="more-button"
          >
            <MoreHorizontal size={22} />
            <span>More</span>
          </button>
        </div>
      </nav>
      <MoreMenu open={moreOpen} onClose={() => setMoreOpen(false)} />
    </>
  )
}
