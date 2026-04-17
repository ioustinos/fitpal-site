import { useState } from 'react'
import { useCartStore, type CartItem } from '../../store/useCartStore'
import { useUIStore } from '../../store/useUIStore'
import { useAuthStore } from '../../store/useAuthStore'
import { makeTr } from '../../lib/translations'
import { activeDays, dayAmt, subTotal, fmt } from '../../lib/helpers'
import { useMenuStore } from '../../store/useMenuStore'

const DAY_LABELS_EL = ['ΔΕΥΤΕΡΑ', 'ΤΡΙΤΗ', 'ΤΕΤΑΡΤΗ', 'ΠΕΜΠΤΗ', 'ΠΑΡΑΣΚΕΥΗ']
const DAY_LABELS_EN = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY']
const DAY_FULL_EL = ['Δευτέρα', 'Τρίτη', 'Τετάρτη', 'Πέμπτη', 'Παρασκευή']
const DAY_FULL_EN = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']

/* ── Goal helpers ── */
function coGoalStatus(key: string, value: number, goals: any): string | null {
  if (!goals?.enabled) return null
  const map: Record<string, string> = { cal: 'calories', protein: 'protein', carbs: 'carbs', fat: 'fat' }
  const g = goals[map[key] ?? key]
  if (!g || typeof g !== 'object') return null
  if (g.min && value < g.min) return 'below'
  if (g.max && value > g.max) return 'above'
  if (g.min || g.max) return 'ok'
  return null
}

function dayCartMacros(items: CartItem[]): { cal: number; protein: number; carbs: number; fat: number } {
  return items.reduce(
    (a, i) => ({
      cal: a.cal + (i.macros?.cal ?? 0) * i.qty,
      protein: a.protein + (i.macros?.pro ?? 0) * i.qty,
      carbs: a.carbs + (i.macros?.carb ?? 0) * i.qty,
      fat: a.fat + (i.macros?.fat ?? 0) * i.qty,
    }),
    { cal: 0, protein: 0, carbs: 0, fat: 0 },
  )
}

const coMacroIcons = {
  cal: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22c-4 0-7-3-7-7.5 0-3 1.5-5.5 3.5-8C10.5 4 12 2 12 2s1.5 2 3.5 4.5c2 2.5 3.5 5 3.5 8C19 19 16 22 12 22z"/></svg>,
  protein: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 14v6M17 17h6"/><circle cx="9" cy="7" r="4"/><path d="M2 21v-2a5 5 0 015-5h4"/></svg>,
  carbs: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2 22L12 2l10 20H2z"/></svg>,
  fat: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><ellipse cx="12" cy="12" rx="4" ry="7"/><circle cx="12" cy="10" r="1" fill="currentColor" stroke="none"/></svg>,
}

export function OrderSummary() {
  const lang = useUIStore((s) => s.lang)
  const activeWeek = useUIStore((s) => s.activeWeek)
  const closeCheckout = useUIStore((s) => s.closeCheckout)
  const cart = useCartStore((s) => s.cart)
  const voucher = useCartStore((s) => s.voucher)
  const applyVoucher = useCartStore((s) => s.applyVoucher)
  const removeVoucher = useCartStore((s) => s.removeVoucher)
  const voucherLoading = useCartStore((s) => s.voucherLoading)
  const updateItem = useCartStore((s) => s.updateItem)
  const removeItem = useCartStore((s) => s.removeItem)
  const user = useAuthStore((s) => s.user)
  const t = makeTr(lang)

  const [voucherInput, setVoucherInput] = useState('')
  const [voucherError, setVoucherError] = useState('')

  const weeks = useMenuStore((s) => s.weeks)
  const minOrder = useMenuStore((s) => s.settings.minOrder)
  const week = weeks[activeWeek] ?? weeks[0]
  const dayIdxs = activeDays(cart)
  const total = subTotal(cart, voucher)

  // Raw subtotal (before voucher)
  const rawTotal = dayIdxs.reduce((sum, i) => sum + dayAmt(cart, i), 0)

  async function handleApplyVoucher() {
    const result = await applyVoucher(voucherInput.trim(), rawTotal, user?.id)
    if (!result.ok) {
      setVoucherError(result.error ?? (lang === 'el' ? 'Άκυρος κωδικός κουπονιού' : 'Invalid voucher code'))
    } else {
      setVoucherError('')
    }
  }

  function handleRemoveVoucher() {
    removeVoucher()
    setVoucherInput('')
    setVoucherError('')
  }

  if (!dayIdxs.length) {
    return (
      <div className="co-summary-card">
        <div className="sidebar-hdr">
          <div className="sidebar-title">{t('cartTitle')}</div>
        </div>
        <div className="cart-empty">
          <div className="cart-empty-img">🛒</div>
          <div className="cart-empty-title">{t('cartEmpty')}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="co-summary-card">
      {/* Header */}
      <div className="sidebar-hdr">
        <div className="sidebar-title">{t('cartTitle')}</div>
        <div className="sidebar-sub">{t('cartSub')}</div>
      </div>

      {/* Scrollable items */}
      <div className="cart-scroll">
        {dayIdxs.map((i) => {
          const items = cart[i] ?? []
          const day = week?.days[i]
          const amt = dayAmt(cart, i)
          const low = amt < minOrder
          const dayLabel = lang === 'el' ? DAY_LABELS_EL[i] : DAY_LABELS_EN[i]

          return (
            <div key={day?.date ?? i} className="cart-day-block">
              <div className="cart-day-hdr">
                <span className="cart-day-name">{dayLabel}</span>
                <span className={`cart-day-amt ${low ? 'low' : 'ok'}`}>
                  {fmt(amt)}{low ? ` / min €${minOrder}` : ''}
                </span>
              </div>

              {items.map((item, j) => {
                const name = lang === 'el' ? item.nameEl : item.nameEn
                const variant = lang === 'el' ? item.variantLabelEl : item.variantLabelEn
                return (
                  <div key={j} className="cart-item">
                    {/* Thumbnail */}
                    <div className="ci-thumb">
                      {item.img ? (
                        <>
                          <img
                            src={item.img}
                            alt={name}
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            onError={(e) => {
                              e.currentTarget.style.display = 'none'
                              const next = e.currentTarget.nextSibling as HTMLElement
                              if (next) next.style.display = 'flex'
                            }}
                          />
                          <div className="ci-thumb-emoji" style={{ display: 'none' }}>
                            {item.emoji ?? '🍽️'}
                          </div>
                        </>
                      ) : (
                        <div className="ci-thumb-emoji">{item.emoji ?? '🍽️'}</div>
                      )}
                    </div>

                    {/* Info */}
                    <div className="ci-info">
                      <div className="ci-name">{name}</div>
                      {variant && <div className="ci-var">{variant}</div>}
                      {item.comment && <div className="ci-comment">"{item.comment}"</div>}
                    </div>

                    {/* Price + qty */}
                    <div className="ci-right">
                      {item.originalPrice && item.originalPrice > item.price && (
                        <div className="ci-price-was">{fmt(item.originalPrice * item.qty)}</div>
                      )}
                      <div className="ci-price">{fmt(item.price * item.qty)}</div>
                      <div className="qty-ctrl">
                        <button
                          className="qty-btn"
                          onClick={() =>
                            item.qty <= 1
                              ? removeItem(i, j)
                              : updateItem(i, j, { qty: item.qty - 1 })
                          }
                        >−</button>
                        <span className="qty-n">{item.qty}</span>
                        <button
                          className="qty-btn"
                          onClick={() => updateItem(i, j, { qty: item.qty + 1 })}
                        >+</button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )
        })}

        {/* Macro overview per day (when goals enabled) */}
        {user?.goals?.enabled && dayIdxs.length > 0 && (
          <div className="co-macro-section">
            <div className="co-macro-title">
              {lang === 'el' ? 'Μακροθρεπτικά ημέρας' : 'Day macros'}
            </div>
            {dayIdxs.map((i) => {
              const items = cart[i] ?? []
              const m = dayCartMacros(items)
              const dayLabel = lang === 'el' ? DAY_FULL_EL[i] : DAY_FULL_EN[i]
              const pills = [
                { k: 'cal', v: m.cal, icon: coMacroIcons.cal },
                { k: 'protein', v: m.protein, icon: coMacroIcons.protein },
                { k: 'carbs', v: m.carbs, icon: coMacroIcons.carbs },
                { k: 'fat', v: m.fat, icon: coMacroIcons.fat },
              ]
              return (
                <div key={i}>
                  <div className="co-macro-day-label">{dayLabel}</div>
                  <div className="co-macro-summary">
                    {pills.map((p) => {
                      const s = coGoalStatus(p.k, p.v, user.goals)
                      return (
                        <div key={p.k} className={`co-macro-pill ${s ?? 'none'}`}>
                          {p.icon}
                          <span>{p.v}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Footer: voucher + total + back */}
      <div className="cart-ftr">
        {/* Voucher widget */}
        {voucher.applied ? (
          <>
            <div className="cart-total-row" style={{ marginBottom: 6 }}>
              <span className="cart-total-lbl" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {lang === 'el' ? 'Υποσύνολο' : 'Subtotal'}
              </span>
              <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-muted)' }}>
                {fmt(rawTotal)}
              </span>
            </div>
            <div className="cart-total-row" style={{ marginBottom: 10 }}>
              <span style={{ fontSize: 12, color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ fontSize: 10, fontWeight: 900, background: 'var(--green-light)', color: 'var(--green-dark)', padding: '1px 6px', borderRadius: 999 }}>
                  {voucher.code}
                </span>
                <span
                  style={{ fontSize: 10, color: 'var(--text-muted)', cursor: 'pointer', textDecoration: 'underline' }}
                  onClick={handleRemoveVoucher}
                >✕</span>
              </span>
              <span style={{ fontSize: 13, fontWeight: 900, color: 'var(--green)' }}>
                −{fmt(rawTotal - total)}
              </span>
            </div>
          </>
        ) : (
          <div className="voucher-row" style={{ marginBottom: 10 }}>
            <input
              className="voucher-input"
              placeholder={lang === 'el' ? 'π.χ. FITPAL10' : 'e.g. FITPAL10'}
              value={voucherInput}
              onChange={(e) => { setVoucherInput(e.target.value.toUpperCase().trim()); setVoucherError('') }}
              style={{ fontSize: 11, padding: '7px 10px' }}
            />
            <button
              className="btn-apply"
              onClick={handleApplyVoucher}
              disabled={voucherLoading}
              style={{ fontSize: 11, padding: '7px 12px' }}
            >
              {voucherLoading ? '...' : (lang === 'el' ? 'Εφαρμογή' : 'Apply')}
            </button>
          </div>
        )}
        {voucherError && (
          <div className="fnote bad" style={{ marginTop: -6, marginBottom: 6 }}>{voucherError}</div>
        )}

        {/* Total */}
        <div className="cart-total-row">
          <span className="cart-total-lbl">{t('total')}</span>
          <span className="cart-total-amt">{fmt(total)}</span>
        </div>

        {/* Back to menu */}
        <button className="btn-back-menu" onClick={closeCheckout}>
          {lang === 'el' ? '← Επιστροφή στο Μενού' : '← Back to Menu'}
        </button>
      </div>
    </div>
  )
}
