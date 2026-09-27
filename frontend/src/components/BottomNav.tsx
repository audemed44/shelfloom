import { useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { NAV_ITEMS, MORE_ITEMS, MoreHorizontal } from './nav/navItems'
import MoreMenu from './nav/MoreMenu'

function itemClass(active: boolean) {
  return `relative flex flex-1 flex-col items-center justify-center gap-1 py-2 text-[10px] font-semibold transition-colors duration-300 ${
    active ? 'text-white' : 'text-white/45'
  }`
}

function ActivePill({ active }: { active: boolean }) {
  return (
    <span
      className={`absolute top-1 h-8 w-12 rounded-full bg-primary/20 shadow-[inset_0_0_0_1px_rgba(139,124,255,0.3)] transition-all duration-300 ${
        active ? 'opacity-100 scale-100' : 'opacity-0 scale-75'
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
        className="fixed inset-x-0 bottom-0 z-30 border-t border-white/[0.07] bg-ink-900/85 backdrop-blur-xl sm:hidden h-mobile-bottom-nav"
        data-testid="bottom-nav"
      >
        <div className="mx-auto flex h-full min-h-[var(--mobile-bottom-nav-height)] max-w-md items-stretch justify-around px-2 pb-mobile-safe">
          {NAV_ITEMS.map(({ to, icon: Icon, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => itemClass(isActive)}
            >
              {({ isActive }) => (
                <>
                  <ActivePill active={isActive} />
                  <Icon
                    size={21}
                    strokeWidth={isActive ? 2.25 : 1.75}
                    className={`relative mt-1 transition-transform duration-300 ${
                      isActive ? 'text-primary-300 -translate-y-px' : ''
                    }`}
                  />
                  <span className="relative">{label}</span>
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
            <ActivePill active={moreActive || moreOpen} />
            <MoreHorizontal
              size={21}
              className={`relative mt-1 ${moreActive || moreOpen ? 'text-primary-300' : ''}`}
            />
            <span className="relative">More</span>
          </button>
        </div>
      </nav>
      <MoreMenu open={moreOpen} onClose={() => setMoreOpen(false)} />
    </>
  )
}
