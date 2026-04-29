import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * Admin impersonation state.
 *
 * When an admin clicks "Place order for this customer" in /admin/users, we
 * stash a snapshot of the customer in this store and bounce the admin to
 * the customer site. From there:
 *
 *   - A persistent yellow banner shows "Impersonating <Customer>" + Exit.
 *   - Checkout's submit-order call sends `impersonateUserId` so the order
 *     is filed under the customer (not the admin).
 *   - The wallet payment option becomes available even when the customer's
 *     wallet is `admin_managed = true` (since the admin IS the curator who
 *     should be spending it).
 *   - On exit, the admin is bounced back to /admin/users.
 *
 * We persist the impersonation state to localStorage so a page refresh
 * doesn't drop us out of impersonation mid-flow. Admin must explicitly
 * click Exit (or place the order, which auto-exits).
 *
 * Security note: the actual ENFORCEMENT happens server-side in
 * submit-order.ts — we re-check `is_admin(auth.uid())` on the JWT before
 * accepting `impersonateUserId`. This client-side store is just convenience
 * state; nothing here can be used to spoof impersonation.
 */

export interface ImpersonatedCustomer {
  userId: string
  email: string
  name: string
  addresses: Array<{
    id: string; labelEl: string; labelEn: string; street: string;
    area: string; zip: string | null; isDefault: boolean
  }>
  walletBalance: number
  walletAdminManaged: boolean
  startedAt: number
}

interface ImpersonationState {
  active: ImpersonatedCustomer | null
  start: (customer: Omit<ImpersonatedCustomer, 'startedAt'>) => void
  stop: () => void
}

export const useImpersonationStore = create<ImpersonationState>()(
  persist(
    (set) => ({
      active: null,
      start: (customer) => set({
        active: { ...customer, startedAt: Date.now() },
      }),
      stop: () => set({ active: null }),
    }),
    { name: 'fitpal-impersonation' },
  ),
)
