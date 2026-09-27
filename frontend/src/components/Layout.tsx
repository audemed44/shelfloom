import { Suspense } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import Sidebar from './Sidebar'
import BottomNav from './BottomNav'

/** Shown for the split second a page's code chunk is downloading. */
function PageFallback() {
  return (
    <div
      className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:px-12 lg:py-10"
      aria-busy="true"
      data-testid="page-fallback"
    >
      <div className="skeleton h-14 w-64 sm:h-20 sm:w-96" />
      <div className="skeleton mt-10 h-px w-full" />
      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="skeleton aspect-[2/3]" />
        ))}
      </div>
    </div>
  )
}

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
          <Suspense fallback={<PageFallback />}>
            <Outlet />
          </Suspense>
        </div>
      </main>

      {/* Bottom nav: mobile only */}
      <BottomNav />
    </div>
  )
}
