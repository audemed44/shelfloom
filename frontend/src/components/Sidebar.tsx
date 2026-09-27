import { NavLink } from 'react-router-dom'
import { Search, type LucideIcon } from 'lucide-react'
import { NAV_ITEMS, MORE_ITEMS } from './nav/navItems'
import Logo from './nav/Logo'
import { useQuickSearch } from './search/QuickSearch'

interface NavItemProps {
  to: string
  icon: LucideIcon
  label: string
  end?: boolean
  index: number
}

function NavItem({ to, icon: Icon, label, end, index }: NavItemProps) {
  return (
    <NavLink
      to={to}
      end={end}
      title={label}
      className={({ isActive }) =>
        `group flex items-center justify-center lg:justify-start gap-3 px-3 py-2.5 text-sm font-semibold transition-colors duration-150 ${
          isActive
            ? 'bg-primary text-white'
            : 'text-white/60 hover:text-white hover:bg-white/[0.06]'
        }`
      }
    >
      {({ isActive }) => (
        <>
          <Icon
            size={18}
            strokeWidth={isActive ? 2.25 : 1.75}
            className="shrink-0 lg:hidden"
          />
          <span
            className={`hidden lg:block w-6 text-[11px] font-medium tabular-nums ${
              isActive ? 'text-white/70' : 'text-white/30'
            }`}
          >
            {String(index).padStart(2, '0')}
          </span>
          <span className="hidden lg:block">{label}</span>
        </>
      )}
    </NavLink>
  )
}

export default function Sidebar() {
  const { open: openSearch } = useQuickSearch()
  return (
    <aside
      className="hidden sm:flex w-20 lg:w-64 fixed top-0 left-0 h-full flex-col border-r border-white/[0.14] bg-black z-40"
      data-testid="sidebar"
    >
      {/* Branding — icon-only on sm/md, full logo on lg+ */}
      <div className="flex items-center justify-center lg:justify-start gap-3 px-4 py-6 lg:px-6">
        <Logo />
        <span className="hidden lg:block text-xl font-extrabold tracking-tighter text-white">
          Shelfloom
        </span>
      </div>

      <div className="px-3 pb-4 lg:px-4">
        <button
          onClick={openSearch}
          title="Search (⌘K)"
          aria-label="Search"
          data-testid="sidebar-search"
          className="flex w-full items-center justify-center gap-3 border border-white/25 px-3 py-2.5 text-sm text-white/60 transition-colors hover:border-white hover:text-white lg:justify-start"
        >
          <Search size={16} className="shrink-0" />
          <span className="hidden lg:block">Search</span>
          <kbd className="ml-auto hidden border border-white/20 px-1.5 text-[10px] text-white/40 lg:block">
            ⌘K
          </kbd>
        </button>
      </div>

      <nav className="flex-1 px-3 lg:px-4">
        <p className="hidden lg:block border-t border-white/[0.14] px-3 pb-2 pt-4 text-[10px] font-semibold tracking-widest text-white/40">
          Browse
        </p>
        <div className="space-y-px">
          {NAV_ITEMS.map((item, i) => (
            <NavItem key={item.to} {...item} index={i + 1} />
          ))}
        </div>
        <div className="my-4 h-px bg-white/[0.14] lg:hidden" />
        <p className="hidden lg:block mt-6 border-t border-white/[0.14] px-3 pb-2 pt-4 text-[10px] font-semibold tracking-widest text-white/40">
          Organize
        </p>
        <div className="space-y-px">
          {MORE_ITEMS.map((item, i) => (
            <NavItem key={item.to} {...item} index={NAV_ITEMS.length + i + 1} />
          ))}
        </div>
      </nav>

      <div className="hidden lg:block px-7 py-6">
        <p className="text-[10px] font-semibold tracking-widest text-white/30">
          Personal library
        </p>
        <p className="mt-1 text-[10px] text-white/25">
          Self-hosted · KOReader sync
        </p>
      </div>
    </aside>
  )
}
