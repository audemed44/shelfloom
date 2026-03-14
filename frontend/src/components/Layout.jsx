import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'

export default function Layout() {
  return (
    <div className="flex min-h-screen bg-black text-white">
      <Sidebar />
      <main className="flex-1 ml-0 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}
