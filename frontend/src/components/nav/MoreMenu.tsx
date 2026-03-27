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
        className="fixed inset-0 bg-black/60 z-40 sm:hidden"
        onClick={onClose}
        data-testid="more-menu-backdrop"
      />

      {/* Bottom sheet */}
      <div
        className="fixed bottom-[57px] left-0 right-0 bg-black border-t border-white/10 rounded-t-xl z-50 sm:hidden"
        data-testid="more-menu"
      >
        <div className="px-4 pt-4 pb-safe-bottom pb-2">
          <div className="w-8 h-1 bg-white/10 rounded-full mx-auto mb-4" />
          <p className="text-[9px] font-black tracking-widest text-white/30 mb-3 px-2">
            MORE
          </p>
          <nav className="space-y-1 pb-4">
            {MORE_ITEMS.map(({ to, icon: Icon, label }) => (
              <NavLink
                key={to}
                to={to}
                onClick={onClose}
                className={({ isActive }) =>
                  `flex items-center gap-4 px-4 py-3 transition-colors ${
                    isActive
                      ? 'text-primary'
                      : 'text-white/60 hover:text-white hover:bg-white/5'
                  }`
                }
                data-testid={`more-menu-item-${label.toLowerCase()}`}
              >
                <Icon size={20} />
                <span className="text-sm font-bold tracking-widest">
                  {label}
                </span>
              </NavLink>
            ))}
          </nav>
        </div>
      </div>
    </>
  )
}
