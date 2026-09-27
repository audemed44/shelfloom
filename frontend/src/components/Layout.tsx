import { Outlet, useLocation } from 'react-router-dom'
import Sidebar from './Sidebar'
import BottomNav from './BottomNav'

export default function Layout() {
  const location = useLocation()

  return (
    <div className="relative flex min-h-screen min-h-dvh flex-col bg-black text-white">
      {/* Sidebar: hidden on mobile, icon-only on sm/md, full on lg+ */}
      <Sidebar />

      {/* Main content: full-width on mobile, offset by sidebar on sm+ */}
      <main className="relative z-10 min-h-screen min-h-dvh flex-1 pb-mobile-bottom-nav sm:ml-20 sm:pb-0 lg:ml-64">
        {/* Re-keyed per route so each page fades in on navigation */}
        <div key={location.pathname} className="animate-fade-in">
          <Outlet />
        </div>
      </main>

      {/* Bottom nav: mobile only */}
      <BottomNav />
    </div>
  )
}
