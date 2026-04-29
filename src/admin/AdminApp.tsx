import { Routes, Route } from 'react-router-dom'
import { AdminGuard } from './AdminGuard'
import { AdminLayout } from './AdminLayout'
import { Dashboard } from './pages/Dashboard'
import { Menus } from './pages/Menus'
import { Dishes } from './pages/Dishes'
import { Orders } from './pages/Orders'
import { Settings } from './pages/Settings'
import { Zones } from './pages/Zones'
import { Vouchers } from './pages/Vouchers'
import { Users } from './pages/Users'
import './admin.css'

/**
 * Root of the admin bundle. Lazy-loaded from App.tsx so the customer bundle
 * stays lean. Everything under /admin/* is wrapped in <AdminGuard>.
 */
export default function AdminApp() {
  return (
    <AdminGuard>
      <Routes>
        <Route element={<AdminLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="menus" element={<Menus />} />
          <Route path="dishes" element={<Dishes />} />
          <Route path="orders" element={<Orders />} />
          <Route path="users" element={<Users />} />
          <Route path="vouchers" element={<Vouchers />} />
          <Route path="settings" element={<Settings />} />
          <Route path="zones" element={<Zones />} />
        </Route>
      </Routes>
    </AdminGuard>
  )
}
