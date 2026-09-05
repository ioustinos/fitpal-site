/**
 * WEC-712 (B2B-4 — per-store checkout): the read-only delivery address on a
 * company/reseller storefront.
 *
 * A company store has exactly ONE delivery address (Ioustinos, 2026-09-06:
 * "each company has ONE address where food can be delivered"), stored as
 * columns on `stores`. The customer does not choose it and cannot edit it, so
 * this renders it plainly with no Edit/Change affordance — no illusion of
 * editability.
 *
 * It also writes that address into the cart's per-day delivery state, so the
 * client-side validation and the submitted payload agree with what the server
 * will write anyway. The server is the actual guard: `submit-order` discards
 * any client-supplied address on a locked store (see `resolveAddressFields`).
 * This component is the honest UI on top of that, not the enforcement.
 *
 * A customer's saved day-preferences deliberately lose to the store's address.
 */

import { useEffect } from 'react'
import { useCartStore } from '../../store/useCartStore'
import { useUIStore } from '../../store/useUIStore'
import { useStorefront } from '../../lib/storefront/StoreProvider'

interface Props {
  /** ISO delivery date this card covers. */
  dayDate: string
}

export function LockedAddressCard({ dayDate }: Props) {
  const lang = useUIStore((s) => s.lang)
  const storefront = useStorefront()
  const delivery = useCartStore((s) => s.delivery)
  const setDelivery = useCartStore((s) => s.setDelivery)

  const addr = storefront.address
  const current = delivery[dayDate]

  // Keep the cart's delivery state in step with the locked address. Runs when
  // the day or the store changes; guarded so it doesn't loop on every render.
  useEffect(() => {
    if (!addr) return
    const same =
      current?.street === (addr.street ?? '') &&
      current?.area === (addr.area ?? '') &&
      (current?.zip ?? '') === (addr.zip ?? '')
    if (same) return
    setDelivery(dayDate, {
      ...current,
      street: addr.street ?? '',
      area: addr.area ?? '',
      zip: addr.zip ?? undefined,
      floor: addr.floor ?? undefined,
      doorbell: addr.doorbell ?? undefined,
      notes: addr.notes ?? undefined,
      addrId: undefined,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayDate, addr?.street, addr?.area, addr?.zip])

  if (!addr) return null

  const el = lang !== 'en'
  const storeName = el ? storefront.name.el : storefront.name.en

  return (
    <div className="locked-addr-card">
      <div className="locked-addr-head">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="11" width="18" height="11" rx="2" />
          <path d="M7 11V7a5 5 0 0110 0v4" />
        </svg>
        <span>{el ? 'Σταθερή διεύθυνση παράδοσης' : 'Fixed delivery address'}</span>
      </div>

      <div className="locked-addr-body">
        <div className="locked-addr-line locked-addr-street">{addr.street}</div>
        <div className="locked-addr-line">
          {[addr.area, addr.zip].filter(Boolean).join(', ')}
        </div>
        {(addr.floor || addr.doorbell) && (
          <div className="locked-addr-line locked-addr-muted">
            {[
              addr.floor ? `${el ? 'Όροφος' : 'Floor'} ${addr.floor}` : '',
              addr.doorbell ? `${el ? 'Κουδούνι' : 'Doorbell'} ${addr.doorbell}` : '',
            ].filter(Boolean).join(' · ')}
          </div>
        )}
        {addr.notes && <div className="locked-addr-line locked-addr-muted">{addr.notes}</div>}
      </div>

      <div className="locked-addr-note">
        {el
          ? `Οι παραγγελίες από το ${storeName} παραδίδονται πάντα σε αυτή τη διεύθυνση.`
          : `Orders from ${storeName} are always delivered to this address.`}
      </div>
    </div>
  )
}
