import { useEffect } from 'react'
import { NavLink } from 'react-router-dom'
import { Search } from 'lucide-react'
import { useQuickSearch } from '../search/QuickSearch'
import { MORE_ITEMS } from './navItems'

interface MoreMenuProps {
  open: boolean
  onClose: () => void
}

export default function MoreMenu({ open, onClose }: MoreMenuProps) {
  const { open: openSearch } = useQuickSearch()
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/70 animate-fade-in sm:hidden"
        onClick={onClose}
        data-testid="more-menu-backdrop"
      />

      {/* Bottom sheet */}
      <div
        className="fixed inset-x-0 z-[60] border-t-2 border-white bg-black animate-slide-up sm:hidden"
        style={{ bottom: 'var(--mobile-bottom-nav-offset)' }}
        data-testid="more-menu"
      >
        <div className="px-4 pb-4 pt-3">
          <p className="pb-3 text-[10px] font-semibold tracking-widest text-white/40">
            More
          </p>
          <nav className="grid grid-cols-2 gap-px bg-white/[0.14] border border-white/[0.14]">
            <button
              onClick={() => {
                onClose()
                openSearch()
              }}
              className="flex flex-col items-start gap-6 bg-black px-3 py-4 text-sm font-semibold text-white/75 transition-colors hover:bg-white/[0.06] hover:text-white"
              data-testid="more-menu-item-search"
            >
              <Search size={22} strokeWidth={1.75} />
              <span>Search</span>
            </button>
            {MORE_ITEMS.map(({ to, icon: Icon, label }) => (
              <NavLink
                key={to}
                to={to}
                onClick={onClose}
                className={({ isActive }) =>
                  `flex flex-col items-start gap-6 px-3 py-4 text-sm font-semibold transition-colors ${
                    isActive
                      ? 'bg-primary text-white'
                      : 'bg-black text-white/75 hover:bg-white/[0.06] hover:text-white'
                  }`
                }
                data-testid={`more-menu-item-${label.toLowerCase()}`}
              >
                <Icon size={22} strokeWidth={1.75} />
                <span>{label}</span>
              </NavLink>
            ))}
          </nav>
        </div>
      </div>
    </>
  )
}
