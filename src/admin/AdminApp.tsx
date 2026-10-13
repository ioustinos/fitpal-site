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
import { Copy } from './pages/Copy'
import { Zones } from './pages/Zones'
// WEC-715: company + reseller storefronts (epic WEC-649).
import { Stores } from './pages/Stores'
import { Vouchers } from './pages/Vouchers'
// WEC-840: dietitian partners (epic WEC-838).
import { Partners } from './pages/Partners'
import { Users } from './pages/Users'
import { WalletPurchases } from './pages/WalletPurchases'
import { WalletSettings } from './pages/WalletSettings'
import { DemoDishes } from './pages/DemoDishes'
import { DesignSystem } from './pages/DesignSystem'
// Costing (epic WEC-857)
import { CostingHome } from './pages/costing/CostingHome'
import { CostItems } from './pages/costing/CostItems'
import { CostSuppliers } from './pages/costing/CostSuppliers'
import { CostPurchases } from './pages/costing/CostPurchases'
import { CostComponents } from './pages/costing/CostComponents'
import { CostLinks } from './pages/costing/CostLinks'
import { CostDishes } from './pages/costing/CostDishes'
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
          <Route path="partners" element={<Partners />} />
          <Route path="vouchers" element={<Vouchers />} />
          <Route path="wallet-purchases" element={<WalletPurchases />} />
          <Route path="wallet-settings"  element={<WalletSettings />} />
          <Route path="demo-dishes"      element={<DemoDishes />} />

          {/* WEC-274 split — typed-per-domain settings pages */}
          <Route path="site-details" element={<SiteDetails />} />
          <Route path="cutoff-schedules" element={<CutoffSchedules />} />
          <Route path="payments" element={<SettingsPayments />} />
          <Route path="menu-options" element={<MenuOptions />} />
          <Route path="advanced" element={<Advanced />} />
          {/* WEC-735: every user-visible string, editable without a deploy. */}
          <Route path="copy" element={<Copy />} />
          <Route path="design-system" element={<DesignSystem />} />

          {/* Legacy /admin/settings redirects to the first settings-group
              page so old bookmarks still land somewhere sensible. */}
          <Route path="settings" element={<Navigate to="/admin/site-details" replace />} />

          <Route path="zones" element={<Zones />} />
          <Route path="stores" element={<Stores />} />
          {/* Costing (epic WEC-857) */}
          <Route path="costing" element={<CostingHome />} />
          <Route path="costing/dishes" element={<CostDishes />} />
          <Route path="costing/components" element={<CostComponents />} />
          <Route path="costing/items" element={<CostItems />} />
          <Route path="costing/purchases" element={<CostPurchases />} />
          <Route path="costing/suppliers" element={<CostSuppliers />} />
          <Route path="costing/links" element={<CostLinks />} />
        </Route>
      </Routes>
    </AdminGuard>
  )
}
