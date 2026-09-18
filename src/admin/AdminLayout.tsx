import { useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'

export function AdminLayout() {
  // WEC-796: the admin tab should be identifiable — set the document title
  // while in the admin app, and restore whatever it was on the way out.
  useEffect(() => {
    const previous = document.title
    document.title = 'Admin - Fitpal'
    return () => { document.title = previous }
  }, [])

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
