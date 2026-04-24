import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'

export function AdminLayout() {
  return (
    <div className="admin-shell">
      <Topbar />
      <div className="admin-body">
        <Sidebar />
        <main className="admin-main">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
