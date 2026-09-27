import { useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { NAV_ITEMS, MORE_ITEMS, MoreHorizontal } from './nav/navItems'
import MoreMenu from './nav/MoreMenu'

function itemClass(active: boolean) {
  return `relative flex flex-1 flex-col items-center justify-center gap-1 py-2 text-[10px] font-semibold transition-colors duration-150 ${
    active ? 'text-white' : 'text-white/45'
  }`
}

/** Blue bar across the top edge of the active tab. */
function ActiveBar({ active }: { active: boolean }) {
  return (
    <span
      className={`absolute inset-x-2 top-0 h-[3px] bg-primary transition-transform duration-200 origin-center ${
        active ? 'scale-x-100' : 'scale-x-0'
      }`}
      aria-hidden="true"
    />
  )
}

export default function BottomNav() {
  const [moreOpen, setMoreOpen] = useState(false)
  const location = useLocation()
  const moreActive = MORE_ITEMS.some((item) =>
    location.pathname.startsWith(item.to)
  )

  return (
    <>
      <nav
        className="fixed inset-x-0 bottom-0 z-30 border-t border-white/[0.14] bg-black sm:hidden h-mobile-bottom-nav"
        data-testid="bottom-nav"
      >
        <div className="mx-auto flex h-full min-h-[var(--mobile-bottom-nav-height)] max-w-md items-stretch justify-around pb-mobile-safe">
          {NAV_ITEMS.map(({ to, icon: Icon, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => itemClass(isActive)}
            >
              {({ isActive }) => (
                <>
                  <ActiveBar active={isActive} />
                  <Icon
                    size={21}
                    strokeWidth={isActive ? 2.25 : 1.75}
                    className={isActive ? 'text-primary-400' : ''}
                  />
                  <span>{label}</span>
                </>
              )}
            </NavLink>
          ))}
          <button
            onClick={() => setMoreOpen((o) => !o)}
            className={itemClass(moreActive || moreOpen)}
            aria-label="More"
            data-testid="more-button"
          >
            <ActiveBar active={moreActive || moreOpen} />
            <MoreHorizontal
              size={21}
              className={moreActive || moreOpen ? 'text-primary-400' : ''}
            />
            <span>More</span>
          </button>
        </div>
      </nav>
      <MoreMenu open={moreOpen} onClose={() => setMoreOpen(false)} />
    </>
  )
}
