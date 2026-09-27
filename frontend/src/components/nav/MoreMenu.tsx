import { useEffect } from 'react'
import { NavLink } from 'react-router-dom'
import { MORE_ITEMS } from './navItems'

interface MoreMenuProps {
  open: boolean
  onClose: () => void
}

export default function MoreMenu({ open, onClose }: MoreMenuProps) {
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
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm animate-fade-in sm:hidden"
        onClick={onClose}
        data-testid="more-menu-backdrop"
      />

      {/* Bottom sheet */}
      <div
        className="fixed left-2 right-2 z-[60] rounded-3xl border border-white/10 bg-ink-850/95 shadow-lift backdrop-blur-xl animate-scale-in sm:hidden"
        style={{ bottom: 'calc(var(--mobile-bottom-nav-offset) + 0.5rem)' }}
        data-testid="more-menu"
      >
        <div className="p-3">
          <p className="px-2 pb-2 pt-1 text-[10px] font-semibold tracking-widest text-white/35">
            More
          </p>
          <nav className="grid grid-cols-3 gap-2">
            {MORE_ITEMS.map(({ to, icon: Icon, label }) => (
              <NavLink
                key={to}
                to={to}
                onClick={onClose}
                className={({ isActive }) =>
                  `flex flex-col items-center gap-2 rounded-2xl px-2 py-4 text-xs font-medium transition-colors ${
                    isActive
                      ? 'bg-primary/20 text-white shadow-[inset_0_0_0_1px_rgba(139,124,255,0.3)]'
                      : 'bg-white/[0.04] text-white/70 hover:bg-white/[0.08] hover:text-white'
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
