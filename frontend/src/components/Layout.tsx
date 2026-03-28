import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import BottomNav from './BottomNav'

export default function Layout() {
  return (
    <div className="flex min-h-screen min-h-dvh flex-col bg-black text-white">
      {/* Sidebar: hidden on mobile, icon-only on sm/md, full on lg+ */}
      <Sidebar />

      {/* Main content: full-width on mobile, offset by sidebar on sm+ */}
      <main className="min-h-screen min-h-dvh flex-1 pb-20 sm:ml-20 sm:pb-0 lg:ml-64">
        <Outlet />
      </main>

      {/* Bottom nav: mobile only */}
      <BottomNav />
    </div>
  )
}
