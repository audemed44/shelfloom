import { NavLink } from 'react-router-dom'
import { type LucideIcon } from 'lucide-react'
import { NAV_ITEMS, MORE_ITEMS } from './nav/navItems'
import Logo from './nav/Logo'

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
      title={label}
      className={({ isActive }) =>
        `group relative flex items-center justify-center lg:justify-start gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-300 ${
          isActive
            ? 'bg-gradient-to-r from-primary/25 via-primary/10 to-transparent text-white shadow-[inset_0_0_0_1px_rgba(139,124,255,0.25)]'
            : 'text-white/55 hover:text-white hover:bg-white/[0.05]'
        }`
      }
    >
      {({ isActive }) => (
        <>
          <span
            className={`absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-primary transition-all duration-300 ${
              isActive ? 'opacity-100' : 'opacity-0 scale-y-50'
            }`}
          />
          <Icon
            size={19}
            strokeWidth={isActive ? 2.25 : 1.75}
            className={`shrink-0 transition-transform duration-300 group-hover:scale-110 ${
              isActive ? 'text-primary-300' : ''
            }`}
          />
          <span className="hidden lg:block">{label}</span>
        </>
      )}
    </NavLink>
  )
}

export default function Sidebar() {
  return (
    <aside
      className="hidden sm:flex w-20 lg:w-64 fixed top-0 left-0 h-full flex-col border-r border-white/[0.06] bg-ink-900/80 backdrop-blur-xl z-40"
      data-testid="sidebar"
    >
      {/* Branding — icon-only on sm/md, full logo on lg+ */}
      <div className="flex items-center justify-center lg:justify-start gap-3 px-4 py-6 lg:px-6">
        <Logo />
        <span className="hidden lg:block font-display text-2xl font-semibold tracking-tight text-white">
          Shelfloom
        </span>
      </div>

      <nav className="flex-1 space-y-1 px-3 lg:px-4">
        <p className="hidden lg:block px-3 pb-2 pt-1 text-[10px] font-semibold tracking-widest text-white/30">
          Browse
        </p>
        {NAV_ITEMS.map((item) => (
          <NavItem key={item.to} {...item} />
        ))}
        <div className="my-4 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
        <p className="hidden lg:block px-3 pb-2 text-[10px] font-semibold tracking-widest text-white/30">
          Organize
        </p>
        {MORE_ITEMS.map((item) => (
          <NavItem key={item.to} {...item} />
        ))}
      </nav>

      <div className="hidden lg:block p-4">
        <div className="rounded-2xl border border-white/[0.06] bg-gradient-to-br from-primary/15 via-transparent to-accent-rose/10 p-4">
          <p className="font-display text-sm italic text-white/80">
            &ldquo;A reader lives a thousand lives.&rdquo;
          </p>
          <p className="mt-1 text-[10px] tracking-widest text-white/35">
            George R.R. Martin
          </p>
        </div>
      </div>
    </aside>
  )
}
