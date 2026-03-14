import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import BottomNav from './BottomNav'

export default function Layout() {
  return (
    <div className="min-h-screen bg-black text-white">
      {/* Sidebar: hidden on mobile, icon-only on sm/md, full on lg+ */}
      <Sidebar />

      {/* Main content: full-width on mobile, offset by sidebar on sm+ */}
      <main className="sm:ml-20 lg:ml-64 pb-20 sm:pb-0 min-h-screen">
        <Outlet />
      </main>

      {/* Bottom nav: mobile only */}
      <BottomNav />
    </div>
  )
}
