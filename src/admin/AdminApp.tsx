import { Routes, Route, Navigate } from 'react-router-dom'
import { AdminGuard } from './AdminGuard'
import { AdminLayout } from './AdminLayout'
import { Dashboard } from './pages/Dashboard'
import { Menus } from './pages/Menus'
import { Allergies } from './pages/Allergies'
import { Categories } from './pages/Categories'
import { Tags } from './pages/Tags'
import { Dishes } from './pages/Dishes'
import { ImportImages } from './pages/ImportImages'
import { ImportMenu } from './pages/ImportMenu'
import { Ingredients } from './pages/Ingredients'
import { Orders } from './pages/Orders'
// WEC-274 split: 5 per-domain pages replace the legacy single Settings page.
// The legacy `Settings.tsx` is kept temporarily because the new pages re-use
// its exported section components — to be deleted once the split settles.
import { SiteDetails } from './pages/SiteDetails'
import { CutoffSchedules } from './pages/CutoffSchedules'
import { Payments as SettingsPayments } from './pages/Payments'
import { MenuOptions } from './pages/MenuOptions'
import { Advanced } from './pages/Advanced'
import { Zones } from './pages/Zones'
import { Vouchers } from './pages/Vouchers'
import { Users } from './pages/Users'
import { WalletPurchases } from './pages/WalletPurchases'
import { WalletSettings } from './pages/WalletSettings'
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
          <Route path="categories" element={<Categories />} />
          <Route path="tags" element={<Tags />} />
          <Route path="ingredients" element={<Ingredients />} />
          <Route path="allergies" element={<Allergies />} />
          <Route path="import-menu" element={<ImportMenu />} />
          <Route path="dish-images" element={<ImportImages />} />
          <Route path="orders" element={<Orders />} />
          <Route path="users" element={<Users />} />
          <Route path="vouchers" element={<Vouchers />} />
          <Route path="wallet-purchases" element={<WalletPurchases />} />
          <Route path="wallet-settings"  element={<WalletSettings />} />

          {/* WEC-274 split — typed-per-domain settings pages */}
          <Route path="site-details" element={<SiteDetails />} />
          <Route path="cutoff-schedules" element={<CutoffSchedules />} />
          <Route path="payments" element={<SettingsPayments />} />
          <Route path="menu-options" element={<MenuOptions />} />
          <Route path="advanced" element={<Advanced />} />

          {/* Legacy /admin/settings redirects to the first settings-group
              page so old bookmarks still land somewhere sensible. */}
          <Route path="settings" element={<Navigate to="/admin/site-details" replace />} />

          <Route path="zones" element={<Zones />} />
        </Route>
      </Routes>
    </AdminGuard>
  )
}
