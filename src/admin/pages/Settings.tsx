import { Fragment, useEffect, useMemo, useState } from 'react'
import {
  fetchAllSettings, setSetting,
  type SettingRow,
} from '../../lib/api/adminSettings'

const DAY_NAMES_FULL = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

type WeekdayOverrides = Record<string, { dow: number; hour: number }>
type DateOverrides = Record<string, { cutoffDate: string; hour: number }>

type PaymentMethod = 'cash' | 'card' | 'link' | 'transfer' | 'wallet'
const ALL_PAYMENT_METHODS: PaymentMethod[] = ['cash', 'card', 'link', 'transfer', 'wallet']
const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Cash on delivery',
  card: 'Card online (Viva)',
  link: 'Payment link (sent later)',
  transfer: 'Bank transfer',
  wallet: 'Fitpal wallet',
}

/** WEC-255: per-method visibility — { public, admin } each. */
type MethodVisibility = { public: boolean; admin: boolean }
type PaymentMethodVisibilityMap = Record<PaymentMethod, MethodVisibility>

interface ContactInfo {
  supportEmail?: string
  supportPhone?: string
  instagramUrl?: string
  facebookUrl?: string
  tiktokUrl?: string
  youtubeUrl?: string
}

interface BankTransferInfo {
  iban?: string
  beneficiary?: string
  bankName?: string
}

/** Pickup location entry (WEC-259 / WEC-276 follow-up). Mirrored from
 *  `src/lib/api/settings.ts` — kept local so this admin module owns its
 *  payload shapes. Field names use snake_case to match what we persist
 *  in `settings.pickup_locations` jsonb. */
interface PickupLocation {
  id: string
  name_el: string
  name_en: string
  address: string
  /** ISO weekday numbers 1=Mon..7=Sun where pickup is offered. */
  available_weekdays: number[]
  hours_note_el?: string
  hours_note_en?: string
}

/** WEC-260: hard cap on the number of IBAN rows the admin can configure. */
const MAX_BANK_IBANS = 5
/** Hard cap on pickup-location rows. 10 is plenty for a single-city op. */
const MAX_PICKUP_LOCATIONS = 10

export function Settings() {
  const [all, setAll] = useState<SettingRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [savingMsg, setSavingMsg] = useState<string | null>(null)

  async function refresh() {
    setLoading(true); setErr(null)
    const s = await fetchAllSettings()
    if (s.error) setErr(s.error)
    setAll(s.data ?? [])
    setLoading(false)
  }
  useEffect(() => { refresh() }, [])

  const byKey = useMemo(() => new Map(all.map((r) => [r.key, r.value])), [all])

  async function save(key: string, value: unknown) {
    setSavingMsg(null)
    const { error } = await setSetting(key, value)
    if (error) { setErr(error); return }
    setSavingMsg('Saved.')
    setTimeout(() => setSavingMsg(null), 1500)
    refresh()
  }

  return (
    <div className="admin-page">
      <h1 className="admin-page-title">Settings</h1>
      <p className="admin-page-sub">Typed editor over the settings table — touch nothing in SQL.</p>

      {err && <div className="admin-error-banner">{err}</div>}
      {savingMsg && <div className="admin-info-banner">{savingMsg}</div>}
      {loading && <div className="admin-loading">Loading…</div>}

      {!loading && (
        <>
          <CutoffHourSection value={Number(byKey.get('cutoff_hour') ?? 18)} onSave={(v) => save('cutoff_hour', v)} />
          <WeekdayOverridesSection value={(byKey.get('cutoff_weekday_overrides') as WeekdayOverrides) ?? {}} onSave={(v) => save('cutoff_weekday_overrides', v)} />
          <DateOverridesSection value={(byKey.get('cutoff_date_overrides') as DateOverrides) ?? {}} onSave={(v) => save('cutoff_date_overrides', v)} />
          <MinOrderSection value={Number(byKey.get('min_order') ?? 1500)} onSave={(v) => save('min_order', v)} />
          <TimeSlotsSection value={(byKey.get('time_slots') as string[]) ?? []} onSave={(v) => save('time_slots', v)} />
          <PaymentMethodsSection value={parseVisibility(byKey.get('payment_methods_enabled'))} onSave={(v) => save('payment_methods_enabled', v)} />
          <MacrosDisplaySection value={(byKey.get('macros_display') === 'dots' ? 'dots' : 'numbers')} onSave={(v) => save('macros_display', v)} />
          <VariantPillThresholdSection value={Number(byKey.get('variant_pill_threshold') ?? 4)} onSave={(v) => save('variant_pill_threshold', v)} />
          <ContactInfoSection value={(byKey.get('contact') as ContactInfo) ?? {}} onSave={(v) => save('contact', v)} />
          <BankTransferInfoSection value={parseBankInfos(byKey.get('bank_transfer_info'))} onSave={(v) => save('bank_transfer_info', v)} />
          <RawJsonSection rows={all} onSaved={refresh} />
        </>
      )}
    </div>
  )
}

// ─── Sections ───────────────────────────────────────────────────────────────

export function SectionCard({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <section className="admin-setting-card">
      <div className="admin-setting-head">
        <h3>{title}</h3>
        {desc && <p>{desc}</p>}
      </div>
      <div className="admin-setting-body">{children}</div>
    </section>
  )
}

export function CutoffHourSection({ value, onSave }: { value: number; onSave: (v: number) => void }) {
  const [h, setH] = useState(value)
  useEffect(() => setH(value), [value])
  return (
    <SectionCard title="Default cutoff hour" desc="Hour on the previous calendar day at which ordering closes for the next-day delivery (unless an override below applies).">
      <div className="admin-inline-form">
        <input className="admin-input" type="number" min={0} max={23} value={h} onChange={(e) => setH(Math.max(0, Math.min(23, +e.target.value || 0)))} style={{ width: 110 }} />
        <span className="admin-text-muted">:00 (24-hour)</span>
        <button className="admin-btn-primary" disabled={h === value} onClick={() => onSave(h)}>Save</button>
      </div>
    </SectionCard>
  )
}

export function WeekdayOverridesSection({ value, onSave }: { value: WeekdayOverrides; onSave: (v: WeekdayOverrides) => void }) {
  const [entries, setEntries] = useState(Object.entries(value).map(([k, v]) => ({ deliveryDow: +k, cutoffDow: v.dow, hour: v.hour })))
  useEffect(() => setEntries(Object.entries(value).map(([k, v]) => ({ deliveryDow: +k, cutoffDow: v.dow, hour: v.hour }))), [value])

  const dirty = JSON.stringify(entries) !== JSON.stringify(Object.entries(value).map(([k, v]) => ({ deliveryDow: +k, cutoffDow: v.dow, hour: v.hour })))

  function add() { setEntries([...entries, { deliveryDow: 1, cutoffDow: 6, hour: 18 }]) }
  function remove(i: number) { setEntries(entries.filter((_, idx) => idx !== i)) }
  function persist() {
    const obj: WeekdayOverrides = {}
    for (const e of entries) obj[String(e.deliveryDow)] = { dow: e.cutoffDow, hour: e.hour }
    onSave(obj)
  }

  return (
    <SectionCard title="Per-weekday cutoff overrides" desc="Choose a different cutoff weekday + hour for specific delivery weekdays. Example: Monday deliveries cut off Saturday 18:00.">
      {entries.length === 0 && <div className="admin-text-muted" style={{ marginBottom: 10 }}>No overrides set.</div>}
      {entries.map((e, i) => (
        <div key={i} className="admin-inline-form">
          <label className="admin-text-muted">Deliveries on</label>
          <select className="admin-select" value={e.deliveryDow} onChange={(ev) => setEntries(entries.map((x, j) => j === i ? { ...x, deliveryDow: +ev.target.value } : x))}>
            {[1, 2, 3, 4, 5, 6, 7].map((d) => <option key={d} value={d}>{DAY_NAMES_FULL[d]}</option>)}
          </select>
          <label className="admin-text-muted">close at</label>
          <select className="admin-select" value={e.cutoffDow} onChange={(ev) => setEntries(entries.map((x, j) => j === i ? { ...x, cutoffDow: +ev.target.value } : x))}>
            {[1, 2, 3, 4, 5, 6, 7].map((d) => <option key={d} value={d}>{DAY_NAMES_FULL[d]}</option>)}
          </select>
          <input className="admin-input" type="number" min={0} max={23} value={e.hour} onChange={(ev) => setEntries(entries.map((x, j) => j === i ? { ...x, hour: Math.max(0, Math.min(23, +ev.target.value || 0)) } : x))} style={{ width: 90 }} />
          <span className="admin-text-muted">:00</span>
          <button className="admin-row-btn danger" onClick={() => remove(i)}>Remove</button>
        </div>
      ))}
      <div className="admin-inline-form" style={{ marginTop: 8 }}>
        <button className="admin-btn-ghost" onClick={add}>+ Add override</button>
        <button className="admin-btn-primary" disabled={!dirty} onClick={persist}>Save all</button>
      </div>
    </SectionCard>
  )
}

export function DateOverridesSection({ value, onSave }: { value: DateOverrides; onSave: (v: DateOverrides) => void }) {
  const [entries, setEntries] = useState(Object.entries(value).map(([k, v]) => ({ deliveryDate: k, cutoffDate: v.cutoffDate, hour: v.hour })))
  useEffect(() => setEntries(Object.entries(value).map(([k, v]) => ({ deliveryDate: k, cutoffDate: v.cutoffDate, hour: v.hour }))), [value])

  const dirty = JSON.stringify(entries) !== JSON.stringify(Object.entries(value).map(([k, v]) => ({ deliveryDate: k, cutoffDate: v.cutoffDate, hour: v.hour })))

  function add() {
    const today = new Date().toISOString().slice(0, 10)
    const yday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
    setEntries([...entries, { deliveryDate: today, cutoffDate: yday, hour: 18 }])
  }
  function remove(i: number) { setEntries(entries.filter((_, idx) => idx !== i)) }
  function persist() {
    const obj: DateOverrides = {}
    for (const e of entries) {
      if (!e.deliveryDate || !e.cutoffDate) continue
      obj[e.deliveryDate] = { cutoffDate: e.cutoffDate, hour: e.hour }
    }
    onSave(obj)
  }

  return (
    <SectionCard title="Per-date cutoff overrides (holidays)" desc="Keys are the delivery date. Example: Christmas Day delivery → cutoff closes 23 Dec 18:00.">
      {entries.length === 0 && <div className="admin-text-muted" style={{ marginBottom: 10 }}>No date overrides set.</div>}
      {entries.map((e, i) => (
        <div key={i} className="admin-inline-form">
          <label className="admin-text-muted">Delivery on</label>
          <input className="admin-input" type="date" value={e.deliveryDate} onChange={(ev) => setEntries(entries.map((x, j) => j === i ? { ...x, deliveryDate: ev.target.value } : x))} />
          <label className="admin-text-muted">closes</label>
          <input className="admin-input" type="date" value={e.cutoffDate} onChange={(ev) => setEntries(entries.map((x, j) => j === i ? { ...x, cutoffDate: ev.target.value } : x))} />
          <label className="admin-text-muted">at</label>
          <input className="admin-input" type="number" min={0} max={23} value={e.hour} onChange={(ev) => setEntries(entries.map((x, j) => j === i ? { ...x, hour: Math.max(0, Math.min(23, +ev.target.value || 0)) } : x))} style={{ width: 80 }} />
          <span className="admin-text-muted">:00</span>
          <button className="admin-row-btn danger" onClick={() => remove(i)}>Remove</button>
        </div>
      ))}
      <div className="admin-inline-form" style={{ marginTop: 8 }}>
        <button className="admin-btn-ghost" onClick={add}>+ Add override</button>
        <button className="admin-btn-primary" disabled={!dirty} onClick={persist}>Save all</button>
      </div>
    </SectionCard>
  )
}

export function MinOrderSection({ value, onSave }: { value: number; onSave: (v: number) => void }) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  const euros = (v / 100).toFixed(2)
  return (
    <SectionCard title="Minimum order per day" desc="Applies to every child order. A zone-specific override in Delivery zones can raise this per zone.">
      <div className="admin-inline-form">
        <span>€</span>
        <input
          className="admin-input" type="number" step="0.50" min={0}
          value={euros}
          onChange={(e) => setV(Math.round((+e.target.value || 0) * 100))}
          style={{ width: 120 }}
        />
        <span className="admin-text-muted">({v} cents)</span>
        <button className="admin-btn-primary" disabled={v === value} onClick={() => onSave(v)}>Save</button>
      </div>
    </SectionCard>
  )
}

export function TimeSlotsSection({ value, onSave }: { value: string[]; onSave: (v: string[]) => void }) {
  const [slots, setSlots] = useState(value)
  useEffect(() => setSlots(value), [value])
  const dirty = JSON.stringify(slots) !== JSON.stringify(value)
  return (
    <SectionCard title="Default delivery time windows" desc='Format "HH:MM-HH:MM". Shown to customers at checkout unless a zone overrides them.'>
      {slots.map((s, i) => (
        <div key={i} className="admin-inline-form">
          <input className="admin-input" value={s} onChange={(e) => setSlots(slots.map((x, j) => j === i ? e.target.value : x))} placeholder="09:00-11:00" style={{ width: 160 }} />
          <button className="admin-row-btn danger" onClick={() => setSlots(slots.filter((_, j) => j !== i))}>Remove</button>
        </div>
      ))}
      <div className="admin-inline-form" style={{ marginTop: 8 }}>
        <button className="admin-btn-ghost" onClick={() => setSlots([...slots, ''])}>+ Add slot</button>
        <button className="admin-btn-primary" disabled={!dirty} onClick={() => onSave(slots.filter(Boolean))}>Save all</button>
      </div>
    </SectionCard>
  )
}

/**
 * Parse settings.payment_methods_enabled into the canonical visibility map
 * (WEC-255). Accepts:
 *   - undefined/null → everything visible to everyone
 *   - legacy array of method strings → those public, all admin
 *   - new object map → validated entry-by-entry
 */
export function parseVisibility(raw: unknown): PaymentMethodVisibilityMap {
  const out: PaymentMethodVisibilityMap = {
    cash:     { public: true, admin: true },
    card:     { public: true, admin: true },
    link:     { public: true, admin: true },
    transfer: { public: true, admin: true },
    wallet:   { public: true, admin: true },
  }
  if (raw == null) return out
  if (Array.isArray(raw)) {
    const inArr = new Set(raw.filter((v) => typeof v === 'string') as string[])
    for (const m of ALL_PAYMENT_METHODS) {
      out[m] = { public: inArr.has(m), admin: true }
    }
    return out
  }
  if (typeof raw === 'object') {
    const obj = raw as Record<string, unknown>
    for (const m of ALL_PAYMENT_METHODS) {
      const e = obj[m]
      if (e && typeof e === 'object') {
        const o = e as Record<string, unknown>
        out[m] = { public: o.public === true, admin: o.admin === true }
      }
    }
    return out
  }
  return out
}

export function PaymentMethodsSection({ value, onSave }: { value: PaymentMethodVisibilityMap; onSave: (v: PaymentMethodVisibilityMap) => void }) {
  const [vis, setVis] = useState<PaymentMethodVisibilityMap>(value)
  useEffect(() => setVis(value), [value])
  const dirty = JSON.stringify(vis) !== JSON.stringify(value)

  // At least one method has to be reachable somewhere — otherwise checkout
  // would be unusable for everyone, including admins.
  const anyEnabled = ALL_PAYMENT_METHODS.some((m) => vis[m].public || vis[m].admin)

  function setFlag(m: PaymentMethod, flag: 'public' | 'admin', on: boolean) {
    setVis({ ...vis, [m]: { ...vis[m], [flag]: on } })
  }

  return (
    <SectionCard
      title="Payment method visibility"
      desc={'Per method: "Public" = shown to customers at checkout, "Admin" = shown when an admin is impersonating a customer. Useful when e.g. you don’t want customers to manage their wallet but admins should be able to debit it on their behalf.'}
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 90px 90px', columnGap: 16, rowGap: 8, alignItems: 'center' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--a-text-muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>Method</div>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--a-text-muted)', textTransform: 'uppercase', letterSpacing: 0.4, textAlign: 'center' }}>Public</div>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--a-text-muted)', textTransform: 'uppercase', letterSpacing: 0.4, textAlign: 'center' }}>Admin</div>
        {ALL_PAYMENT_METHODS.map((m) => (
          <Fragment key={m}>
            <div>
              <strong>{PAYMENT_METHOD_LABELS[m]}</strong>{' '}
              <code style={{ color: 'var(--a-text-muted)', fontSize: 11 }}>{m}</code>
            </div>
            <label style={{ display: 'flex', justifyContent: 'center' }}>
              <input
                type="checkbox"
                checked={vis[m].public}
                onChange={(e) => setFlag(m, 'public', e.target.checked)}
              />
            </label>
            <label style={{ display: 'flex', justifyContent: 'center' }}>
              <input
                type="checkbox"
                checked={vis[m].admin}
                onChange={(e) => setFlag(m, 'admin', e.target.checked)}
              />
            </label>
          </Fragment>
        ))}
      </div>
      <div className="admin-inline-form" style={{ marginTop: 14 }}>
        <button className="admin-btn-primary" disabled={!dirty || !anyEnabled} onClick={() => onSave(vis)}>
          Save
        </button>
        {!anyEnabled && <span className="admin-text-muted">At least one method must stay reachable.</span>}
      </div>
    </SectionCard>
  )
}

export function MacrosDisplaySection({ value, onSave }: { value: 'numbers' | 'dots'; onSave: (v: 'numbers' | 'dots') => void }) {
  const [v, setV] = useState<'numbers' | 'dots'>(value)
  useEffect(() => setV(value), [value])
  return (
    <SectionCard
      title="Customer dish-card macros (WEC-254)"
      desc='Numbers = real values for the preselected variant ("405 kcal / 37g Πρωτ. / 27g Υδ/κες / 17g Λίπη"). Dots = legacy 1-5 admin-set scale. Flip back to dots if the raw numbers feel misleading without context.'
    >
      <div className="admin-inline-form">
        <label className="admin-form-checkbox">
          <input type="radio" name="macros_display" value="numbers" checked={v === 'numbers'} onChange={() => setV('numbers')} />
          <span>Numbers (default)</span>
        </label>
        <label className="admin-form-checkbox">
          <input type="radio" name="macros_display" value="dots" checked={v === 'dots'} onChange={() => setV('dots')} />
          <span>Dots (legacy)</span>
        </label>
        <button className="admin-btn-primary" disabled={v === value} onClick={() => onSave(v)}>Save</button>
      </div>
    </SectionCard>
  )
}

export function VariantPillThresholdSection({ value, onSave }: { value: number; onSave: (v: number) => void }) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  const clamped = Math.max(2, Math.min(20, v))
  return (
    <SectionCard
      title="Variant picker threshold"
      desc="A dish with MORE THAN this many variants automatically renders the dropdown picker on the dish modal (per-ingredient gram pickers). At or below this number, it renders the pill rows. Per-dish admin overrides on /admin/dishes still win. Default 4. Range 2–20."
    >
      <div className="admin-inline-form">
        <input
          className="admin-input"
          type="number"
          min={2}
          max={20}
          value={v}
          onChange={(e) => setV(Math.max(2, Math.min(20, parseInt(e.target.value, 10) || 0)))}
          style={{ width: 110 }}
        />
        <span className="admin-text-muted">variants → switch to dropdowns above this</span>
        <button
          className="admin-btn-primary"
          disabled={clamped === value}
          onClick={() => onSave(clamped)}
        >
          Save
        </button>
      </div>
    </SectionCard>
  )
}

export function ContactInfoSection({ value, onSave }: { value: ContactInfo; onSave: (v: ContactInfo) => void }) {
  const [form, setForm] = useState<ContactInfo>(value)
  useEffect(() => setForm(value), [value])
  const dirty = JSON.stringify(form) !== JSON.stringify(value)

  function patch<K extends keyof ContactInfo>(k: K, v: ContactInfo[K]) {
    setForm((f) => ({ ...f, [k]: v }))
  }

  return (
    <SectionCard title="Contact & social" desc="Customer-facing — appears in the footer and order emails.">
      <div className="admin-grid-2">
        <div>
          <label className="admin-form-label">Support email</label>
          <input className="admin-input" type="email" value={form.supportEmail ?? ''} onChange={(e) => patch('supportEmail', e.target.value)} placeholder="hello@fitpal.gr" />
        </div>
        <div>
          <label className="admin-form-label">Support phone</label>
          <input className="admin-input" type="tel" value={form.supportPhone ?? ''} onChange={(e) => patch('supportPhone', e.target.value)} placeholder="+30 210 …" />
        </div>
        <div>
          <label className="admin-form-label">Instagram URL</label>
          <input className="admin-input" type="url" value={form.instagramUrl ?? ''} onChange={(e) => patch('instagramUrl', e.target.value)} placeholder="https://instagram.com/…" />
        </div>
        <div>
          <label className="admin-form-label">Facebook URL</label>
          <input className="admin-input" type="url" value={form.facebookUrl ?? ''} onChange={(e) => patch('facebookUrl', e.target.value)} placeholder="https://facebook.com/…" />
        </div>
        <div>
          <label className="admin-form-label">TikTok URL</label>
          <input className="admin-input" type="url" value={form.tiktokUrl ?? ''} onChange={(e) => patch('tiktokUrl', e.target.value)} placeholder="https://tiktok.com/@…" />
        </div>
        <div>
          <label className="admin-form-label">YouTube URL</label>
          <input className="admin-input" type="url" value={form.youtubeUrl ?? ''} onChange={(e) => patch('youtubeUrl', e.target.value)} placeholder="https://youtube.com/@…" />
        </div>
      </div>
      <div className="admin-inline-form" style={{ marginTop: 12 }}>
        <button className="admin-btn-primary" disabled={!dirty} onClick={() => onSave(form)}>Save</button>
      </div>
    </SectionCard>
  )
}

/**
 * WEC-260: parse settings.bank_transfer_info into an array.
 * - undefined/null → empty array (admin gets one blank row to fill)
 * - legacy single object → wrapped in [obj]
 * - array → returned as-is, capped at MAX_BANK_IBANS
 */
export function parseBankInfos(raw: unknown): BankTransferInfo[] {
  if (!raw) return []
  const list = Array.isArray(raw) ? raw : [raw]
  const out: BankTransferInfo[] = []
  for (const e of list) {
    if (out.length >= MAX_BANK_IBANS) break
    if (!e || typeof e !== 'object') continue
    const o = e as Record<string, unknown>
    out.push({
      iban: typeof o.iban === 'string' ? o.iban : '',
      beneficiary: typeof o.beneficiary === 'string' ? o.beneficiary : '',
      bankName: typeof o.bankName === 'string' ? o.bankName : '',
    })
  }
  return out
}

export function BankTransferInfoSection({ value, onSave }: { value: BankTransferInfo[]; onSave: (v: BankTransferInfo[]) => void }) {
  // Always show at least one editable row so a fresh install isn't blank.
  const [rows, setRows] = useState<BankTransferInfo[]>(value.length > 0 ? value : [{ iban: '', beneficiary: '', bankName: '' }])
  useEffect(() => {
    setRows(value.length > 0 ? value : [{ iban: '', beneficiary: '', bankName: '' }])
  }, [value])

  // Compare against the saved value; ignore the synthetic empty placeholder
  // we add for first-time UX (rows[0] all-empty + value is an empty array
  // means "no real change").
  const cleaned = rows.filter((r) => (r.iban ?? '').trim().length > 0)
  const dirty = JSON.stringify(cleaned) !== JSON.stringify(value)

  function patchRow(i: number, k: keyof BankTransferInfo, v: string) {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)))
  }
  function add() {
    if (rows.length >= MAX_BANK_IBANS) return
    setRows([...rows, { iban: '', beneficiary: '', bankName: '' }])
  }
  function remove(i: number) {
    setRows((rs) => (rs.length === 1 ? [{ iban: '', beneficiary: '', bankName: '' }] : rs.filter((_, j) => j !== i)))
  }

  return (
    <SectionCard
      title="Bank transfer info"
      desc={`Up to ${MAX_BANK_IBANS} IBANs shown to customers who pick bank transfer. The wallet-plan purchase flow uses the first one. Empty rows are dropped on save.`}
    >
      {rows.map((r, i) => (
        <div key={i} className="admin-grid-2" style={{ marginBottom: 12, paddingBottom: 12, borderBottom: i < rows.length - 1 ? '1px dashed var(--a-border)' : 'none' }}>
          <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <strong style={{ fontSize: 12, color: 'var(--a-text-muted)' }}>IBAN #{i + 1}</strong>
            <button className="admin-row-btn danger" onClick={() => remove(i)}>Remove</button>
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label className="admin-form-label">IBAN</label>
            <input className="admin-input" type="text" value={r.iban ?? ''} onChange={(e) => patchRow(i, 'iban', e.target.value)} placeholder="GR00 0000 0000 0000 0000 0000 000" />
          </div>
          <div>
            <label className="admin-form-label">Beneficiary</label>
            <input className="admin-input" type="text" value={r.beneficiary ?? ''} onChange={(e) => patchRow(i, 'beneficiary', e.target.value)} placeholder="Fitpal Meals" />
          </div>
          <div>
            <label className="admin-form-label">Bank name (optional)</label>
            <input className="admin-input" type="text" value={r.bankName ?? ''} onChange={(e) => patchRow(i, 'bankName', e.target.value)} placeholder="Eurobank, Πειραιώς…" />
          </div>
        </div>
      ))}
      <div className="admin-inline-form" style={{ marginTop: 4 }}>
        <button className="admin-btn-ghost" onClick={add} disabled={rows.length >= MAX_BANK_IBANS}>
          + Add IBAN ({rows.length}/{MAX_BANK_IBANS})
        </button>
        <button className="admin-btn-primary" disabled={!dirty} onClick={() => onSave(cleaned)}>Save</button>
      </div>
    </SectionCard>
  )
}

/**
 * WEC-276 follow-up: parse settings.pickup_locations into an array.
 * Mirrors the customer-side parser in `src/lib/api/settings.ts` — but here
 * we keep the snake_case shape (what's persisted in jsonb) for the admin UI
 * so save round-trips work cleanly.
 */
export function parsePickupLocations(raw: unknown): PickupLocation[] {
  if (!Array.isArray(raw)) return []
  const out: PickupLocation[] = []
  for (const e of raw as unknown[]) {
    if (out.length >= MAX_PICKUP_LOCATIONS) break
    if (!e || typeof e !== 'object') continue
    const o = e as Record<string, unknown>
    const id = typeof o.id === 'string' ? o.id : ''
    if (!id) continue
    const weekdays = Array.isArray(o.available_weekdays)
      ? (o.available_weekdays as unknown[]).filter((v): v is number =>
          typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 7,
        )
      : []
    out.push({
      id,
      name_el: typeof o.name_el === 'string' ? o.name_el : '',
      name_en: typeof o.name_en === 'string' ? o.name_en : '',
      address: typeof o.address === 'string' ? o.address : '',
      available_weekdays: weekdays,
      hours_note_el: typeof o.hours_note_el === 'string' ? o.hours_note_el : undefined,
      hours_note_en: typeof o.hours_note_en === 'string' ? o.hours_note_en : undefined,
    })
  }
  return out
}

const WEEKDAY_LABELS_SHORT = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export function PickupLocationsSection({
  value,
  onSave,
}: {
  value: PickupLocation[]
  onSave: (v: PickupLocation[]) => void
}) {
  // Match the BankTransferInfoSection pattern — always show at least one
  // editable row so a fresh install isn't blank. The synthetic empty row
  // is filtered out at save time.
  function blank(): PickupLocation {
    return {
      id: typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `pickup-${Math.random().toString(36).slice(2, 10)}`,
      name_el: '',
      name_en: '',
      address: '',
      available_weekdays: [1, 2, 3, 4, 5],
    }
  }

  const [rows, setRows] = useState<PickupLocation[]>(value.length > 0 ? value : [blank()])
  useEffect(() => {
    setRows(value.length > 0 ? value : [blank()])
  }, [value])

  // A row is "real" if it has at least a name or an address. Empty rows
  // get dropped on save.
  const cleaned = rows.filter(
    (r) => (r.name_el ?? '').trim().length > 0 || (r.name_en ?? '').trim().length > 0 || (r.address ?? '').trim().length > 0,
  )
  const dirty = JSON.stringify(cleaned) !== JSON.stringify(value)

  function patch<K extends keyof PickupLocation>(i: number, k: K, v: PickupLocation[K]) {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)))
  }
  function toggleWeekday(i: number, dow: number) {
    setRows((rs) =>
      rs.map((r, j) => {
        if (j !== i) return r
        const has = r.available_weekdays.includes(dow)
        const next = has
          ? r.available_weekdays.filter((d) => d !== dow)
          : [...r.available_weekdays, dow].sort((a, b) => a - b)
        return { ...r, available_weekdays: next }
      }),
    )
  }
  function add() {
    if (rows.length >= MAX_PICKUP_LOCATIONS) return
    setRows([...rows, blank()])
  }
  function remove(i: number) {
    setRows((rs) => (rs.length === 1 ? [blank()] : rs.filter((_, j) => j !== i)))
  }

  return (
    <SectionCard
      title="Pickup locations"
      desc={`Where customers can collect orders instead of having them delivered. Up to ${MAX_PICKUP_LOCATIONS}. Empty rows are dropped on save. Customers see these at checkout when the fulfilment toggle is set to Pickup.`}
    >
      {rows.map((r, i) => (
        <div
          key={r.id}
          className="admin-grid-2"
          style={{
            marginBottom: 12,
            paddingBottom: 12,
            borderBottom: i < rows.length - 1 ? '1px dashed var(--a-border)' : 'none',
          }}
        >
          <div
            style={{
              gridColumn: '1 / -1',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 4,
            }}
          >
            <strong style={{ fontSize: 12, color: 'var(--a-text-muted)' }}>Location #{i + 1}</strong>
            <button className="admin-row-btn danger" onClick={() => remove(i)}>
              Remove
            </button>
          </div>
          <div>
            <label className="admin-form-label">Name (EL)</label>
            <input
              className="admin-input"
              type="text"
              value={r.name_el ?? ''}
              onChange={(e) => patch(i, 'name_el', e.target.value)}
              placeholder="π.χ. Καφέ Κολωνάκι"
            />
          </div>
          <div>
            <label className="admin-form-label">Name (EN)</label>
            <input
              className="admin-input"
              type="text"
              value={r.name_en ?? ''}
              onChange={(e) => patch(i, 'name_en', e.target.value)}
              placeholder="e.g. Kolonaki Cafe"
            />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label className="admin-form-label">Address</label>
            <input
              className="admin-input"
              type="text"
              value={r.address ?? ''}
              onChange={(e) => patch(i, 'address', e.target.value)}
              placeholder="Πλατεία Κολωνακίου 5, Αθήνα 10676"
            />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label className="admin-form-label">Available days</label>
            <div className="admin-inline-form" style={{ flexWrap: 'wrap' }}>
              {[1, 2, 3, 4, 5, 6, 7].map((dow) => (
                <label
                  key={dow}
                  className="admin-form-checkbox"
                  style={{ minWidth: 60 }}
                >
                  <input
                    type="checkbox"
                    checked={r.available_weekdays.includes(dow)}
                    onChange={() => toggleWeekday(i, dow)}
                  />
                  <span>{WEEKDAY_LABELS_SHORT[dow]}</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="admin-form-label">Hours note (EL, optional)</label>
            <input
              className="admin-input"
              type="text"
              value={r.hours_note_el ?? ''}
              onChange={(e) => patch(i, 'hours_note_el', e.target.value)}
              placeholder="π.χ. 12:00–18:00"
            />
          </div>
          <div>
            <label className="admin-form-label">Hours note (EN, optional)</label>
            <input
              className="admin-input"
              type="text"
              value={r.hours_note_en ?? ''}
              onChange={(e) => patch(i, 'hours_note_en', e.target.value)}
              placeholder="e.g. 12:00–18:00"
            />
          </div>
        </div>
      ))}
      <div className="admin-inline-form" style={{ marginTop: 4 }}>
        <button className="admin-btn-ghost" onClick={add} disabled={rows.length >= MAX_PICKUP_LOCATIONS}>
          + Add location ({rows.length}/{MAX_PICKUP_LOCATIONS})
        </button>
        <button className="admin-btn-primary" disabled={!dirty} onClick={() => onSave(cleaned)}>
          Save
        </button>
      </div>
    </SectionCard>
  )
}

export function RawJsonSection({ rows, onSaved }: { rows: SettingRow[]; onSaved: () => void }) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [err, setErr] = useState<string | null>(null)

  function startEdit(r: SettingRow) {
    setEditing(r.key)
    setText(JSON.stringify(r.value, null, 2))
    setErr(null)
  }

  async function save() {
    if (!editing) return
    try {
      const parsed = JSON.parse(text)
      const { error } = await setSetting(editing, parsed)
      if (error) { setErr(error); return }
      setEditing(null); onSaved()
    } catch { setErr('Invalid JSON.') }
  }

  return (
    <SectionCard title="Raw settings (escape hatch)" desc="For keys the typed editor doesn't cover — edit the JSON directly. Mind the shape.">
      <button className="admin-btn-ghost" onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Show'} all {rows.length} keys</button>
      {open && (
        <div style={{ marginTop: 10 }}>
          <table className="admin-table admin-table-tight">
            <thead><tr><th>Key</th><th>Value</th><th></th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td><code>{r.key}</code></td>
                  <td><code style={{ fontSize: 12 }}>{JSON.stringify(r.value).slice(0, 80)}</code></td>
                  <td><button className="admin-row-btn" onClick={() => startEdit(r)}>Edit JSON</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <div className="admin-modal-overlay" onClick={() => setEditing(null)}>
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            <header className="admin-drawer-head">
              <h2>Edit raw: <code>{editing}</code></h2>
              <button className="admin-drawer-close" onClick={() => setEditing(null)}>×</button>
            </header>
            <div className="admin-drawer-body">
              {err && <div className="admin-error-banner">{err}</div>}
              <textarea className="admin-input admin-textarea" rows={16} value={text} onChange={(e) => setText(e.target.value)} style={{ fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontSize: 13 }} />
            </div>
            <footer className="admin-drawer-foot">
              <div style={{ flex: 1 }} />
              <button className="admin-btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
              <button className="admin-btn-primary" onClick={save}>Save JSON</button>
            </footer>
          </div>
        </div>
      )}
    </SectionCard>
  )
}
