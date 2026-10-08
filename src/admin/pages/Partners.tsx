/**
 * WEC-840 (partners CRUD, per-client terms, feature switches) +
 * WEC-848 admin leg (commission lines, mark paid single/bulk, payouts) +
 * WEC-850 (internal partner flag) — epic WEC-838 Dietitian Partners.
 *
 * 🟢 Only Fitpal changes discount/commission rates and marks payouts.
 * 🟢 Hidden paid add-ons are switched on here per partner.
 */
import { useEffect, useMemo, useState } from 'react'
import {
  fetchPartners, savePartner, fetchPartnerUsers, addPartnerUser, fetchPartnerClients,
  updateClientTerms, approveLink, adminLinkClient, fetchPartnerLines, markPaid, fetchPayouts,
  type AdminPartner, type PartnerBalance, type AdminPartnerUser, type AdminPartnerClient,
  type AdminCommissionLine, type AdminPayout,
} from '../../lib/api/adminPartners'

const eur = (c: number | null | undefined) => `${((c ?? 0) / 100).toFixed(2)} €`
const pctOf = (bps: number) => `${(bps / 100).toFixed(bps % 100 ? 1 : 0)}%`
const fmtD = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('el-GR') : '—')

export function Partners() {
  const [partners, setPartners] = useState<AdminPartner[]>([])
  const [balances, setBalances] = useState<PartnerBalance[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  async function refresh(keep?: string | null) {
    setLoading(true); setErr(null)
    const r = await fetchPartners()
    if (r.error) setErr(r.error)
    setPartners(r.data); setBalances(r.balances)
    if (keep !== undefined) setSelectedId(keep)
    setLoading(false)
  }
  useEffect(() => { void refresh() }, [])

  const bal = useMemo(() => new Map(balances.map((b) => [b.partnerId, b])), [balances])
  const selected = partners.find((p) => p.id === selectedId) ?? null
  const totalOwed = balances.reduce((a, b) => a + b.outstanding, 0)
  const pendingTotal = balances.reduce((a, b) => a + b.pendingClients, 0)

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <h1 className="admin-page-title">Dietitians (partners)</h1>
          <p className="admin-page-sub">
            {partners.length} partners · owed {eur(totalOwed)}{pendingTotal ? ` · ${pendingTotal} client links awaiting approval` : ''}
          </p>
        </div>
        <button className="admin-btn-primary" onClick={() => { setCreating(true); setSelectedId(null) }}>+ New dietitian</button>
      </div>
      {err && <div className="admin-error-banner">{err}</div>}
      {loading && <div className="admin-loading">Loading…</div>}
      {!loading && (
        <div className="admin-zones-layout">
          <aside className="admin-zones-list">
            {partners.length === 0 && <div className="admin-text-muted" style={{ padding: 14 }}>No dietitians yet.</div>}
            {partners.map((p) => {
              const b = bal.get(p.id)
              return (
                <button key={p.id} className={`admin-zone-item${selectedId === p.id ? ' selected' : ''}${!p.active ? ' inactive' : ''}`}
                        onClick={() => { setSelectedId(p.id); setCreating(false) }}>
                  <div className="admin-zone-item-name">{p.name}{p.is_internal ? ' · Fitpal' : ''}</div>
                  <div className="admin-zone-item-meta">
                    {b?.activeClients ?? 0} clients{b?.pendingClients ? ` · ${b.pendingClients} pending` : ''} · owed {eur(b?.outstanding)}
                  </div>
                </button>
              )
            })}
          </aside>
          <div className="admin-zones-editor">
            {creating ? (
              <PartnerForm key="new" partner={null} onSaved={(p) => { setCreating(false); void refresh(p?.id ?? null) }} onCancel={() => setCreating(false)} />
            ) : selected ? (
              <PartnerEditor key={selected.id} partner={selected} onChanged={() => refresh(selected.id)} />
            ) : (
              <div className="admin-text-muted" style={{ padding: 40, textAlign: 'center' }}>Pick a dietitian, or create one.</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function PartnerEditor({ partner, onChanged }: { partner: AdminPartner; onChanged: () => void }) {
  const [tab, setTab] = useState<'details' | 'clients' | 'money'>('clients')
  return (
    <div style={{ padding: 16 }}>
      <div className="admin-tabs">
        <button className={`admin-tab${tab === 'clients' ? ' active' : ''}`} onClick={() => setTab('clients')}>Clients & terms</button>
        <button className={`admin-tab${tab === 'money' ? ' active' : ''}`} onClick={() => setTab('money')}>Commission & payouts</button>
        <button className={`admin-tab${tab === 'details' ? ' active' : ''}`} onClick={() => setTab('details')}>Details & add-ons</button>
      </div>
      {tab === 'details' && <PartnerForm partner={partner} onSaved={() => onChanged()} />}
      {tab === 'clients' && <ClientsTab partner={partner} onChanged={onChanged} />}
      {tab === 'money' && <MoneyTab partner={partner} onChanged={onChanged} />}
    </div>
  )
}

function PartnerForm({ partner, onSaved, onCancel }: { partner: AdminPartner | null; onSaved: (p: AdminPartner | null) => void; onCancel?: () => void }) {
  const [f, setF] = useState({
    name: partner?.name ?? '', legal_name: partner?.legal_name ?? '', vat_number: partner?.vat_number ?? '',
    tax_office: partner?.tax_office ?? '', address: partner?.address ?? '', email: partner?.email ?? '',
    phone: partner?.phone ?? '', iban: partner?.iban ?? '',
    commission: String((partner?.default_commission_bps ?? 1200) / 100),
    discount: String((partner?.default_discount_bps ?? 0) / 100),
    is_internal: partner?.is_internal ?? false, active: partner?.active ?? true,
    progress_tracking: !!partner?.features?.progress_tracking, referral: !!partner?.features?.referral,
    notifications: !!partner?.features?.notifications,
    referral_code: partner?.referral_code ?? '', agreement_date: partner?.agreement_date ?? '', notes: partner?.notes ?? '',
  })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [users, setUsers] = useState<AdminPartnerUser[]>([])
  const [newUser, setNewUser] = useState('')
  const upd = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value }))

  useEffect(() => { if (partner) void fetchPartnerUsers(partner.id).then((r) => setUsers(r.data)) }, [partner])

  async function save() {
    setBusy(true); setMsg(null)
    const comm = Math.round(Number(f.commission.replace(',', '.')) * 100)
    const disc = Math.round(Number(f.discount.replace(',', '.')) * 100)
    if (!f.name.trim() || Number.isNaN(comm) || Number.isNaN(disc)) { setBusy(false); setMsg('✗ Name and valid percentages are required'); return }
    const { data, error } = await savePartner({
      id: partner?.id, name: f.name.trim(), legal_name: f.legal_name || null, vat_number: f.vat_number || null,
      tax_office: f.tax_office || null, address: f.address || null, email: f.email || null, phone: f.phone || null,
      iban: f.iban || null, default_commission_bps: comm, default_discount_bps: disc, is_internal: f.is_internal,
      active: f.active, features: { progress_tracking: f.progress_tracking, referral: f.referral, notifications: f.notifications },
      referral_code: f.referral_code.trim() || null, agreement_date: f.agreement_date || null, notes: f.notes || null,
    })
    setBusy(false)
    if (error) { setMsg(`✗ ${error}`); return }
    setMsg('✓ Saved'); onSaved(data)
  }

  async function linkUser() {
    if (!partner) return
    const { error } = await addPartnerUser(partner.id, newUser)
    if (error) { setMsg(`✗ ${error}`); return }
    setNewUser(''); setUsers((await fetchPartnerUsers(partner.id)).data)
  }

  const input = (k: keyof typeof f, label: string, type = 'text') => (
    <label style={{ display: 'block' }}>
      <span className="admin-form-label" style={{ display: 'block', fontSize: 12 }}>{label}</span>
      <input className="admin-input" style={{ width: '100%' }} type={type} value={f[k] as string} onChange={upd(k)} />
    </label>
  )
  const check = (k: keyof typeof f, label: string, hint?: string) => (
    <label className="admin-form-checkbox" style={{ display: 'flex', gap: 8, alignItems: 'flex-start', margin: '6px 0' }}>
      <input type="checkbox" checked={f[k] as boolean} onChange={upd(k)} />
      <span>{label}{hint && <span className="admin-text-muted" style={{ display: 'block', fontSize: 12 }}>{hint}</span>}</span>
    </label>
  )

  return (
    <div style={{ padding: partner ? 0 : 16 }}>
      {!partner && <h2 style={{ marginTop: 0 }}>New dietitian</h2>}
      <div className="admin-form-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {input('name', 'Display name *')}
        {input('legal_name', 'Legal name (invoices)')}
        {input('vat_number', 'ΑΦΜ')}
        {input('tax_office', 'ΔΟΥ')}
        {input('email', 'Email')}
        {input('phone', 'Phone')}
        {input('iban', 'IBAN')}
        {input('address', 'Address')}
        {input('commission', 'Default commission % (spec: 12)')}
        {input('discount', 'Default client discount %')}
        {input('agreement_date', 'Agreement date', 'date')}
        {input('referral_code', 'Referral code (for /ref/<code>)')}
      </div>
      <div style={{ marginTop: 10 }}>
        {check('active', 'Active')}
        {check('is_internal', 'Fitpal in-house dietitian', 'Sees every customer, earns no commission, admin access unaffected.')}
        <div className="admin-section-head" style={{ marginTop: 10 }}><strong>Paid add-ons (hidden unless switched on)</strong></div>
        {check('progress_tracking', 'Progress tracking', 'Measurement history + weight chart in the client card.')}
        {check('referral', 'Referral link + QR', 'Self sign-ups via /ref/<code> become this dietitian\'s clients.')}
        {check('notifications', 'Notifications to dietitian', 'Not built yet (WEC-853) — the switch is stored but nothing sends.')}
      </div>
      <label style={{ display: 'block', marginTop: 10 }}>
        <span className="admin-form-label" style={{ display: 'block', fontSize: 12 }}>Notes</span>
        <textarea className="admin-textarea" rows={2} style={{ width: '100%' }} value={f.notes} onChange={upd('notes')} />
      </label>
      <div className="admin-form-actions">
        {msg && <span className="admin-text-muted">{msg}</span>}
        {onCancel && <button className="admin-btn-ghost" onClick={onCancel}>Cancel</button>}
        <button className="admin-btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </div>

      {partner && (
        <div style={{ marginTop: 18 }}>
          <div className="admin-section-head"><strong>Portal logins</strong> <span className="admin-text-muted">— they sign in at /partner</span></div>
          {users.length === 0 && <p className="admin-text-muted">No login linked yet.</p>}
          <ul className="partner-list">{users.map((u) => <li key={u.id}>{u.name ?? ''} {u.email}</li>)}</ul>
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <input className="admin-input" placeholder="email of an existing account" value={newUser} onChange={(e) => setNewUser(e.target.value)} />
            <button className="admin-btn-secondary" onClick={linkUser} disabled={!newUser.trim()}>Link login</button>
          </div>
          <p className="admin-text-muted" style={{ fontSize: 12 }}>The account must exist — create it from Users (Νέος πελάτης) if the dietitian has never signed in.</p>
        </div>
      )}
    </div>
  )
}

function ClientsTab({ partner, onChanged }: { partner: AdminPartner; onChanged: () => void }) {
  const [rows, setRows] = useState<AdminPartnerClient[]>([])
  const [showInactive, setShowInactive] = useState(false)
  const [linkEmail, setLinkEmail] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  async function load() { setRows((await fetchPartnerClients(partner.id)).data) }
  useEffect(() => { void load() }, [partner.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const visible = rows.filter((r) => showInactive || r.status !== 'inactive')
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
        <input className="admin-input" placeholder="link an existing customer by email" value={linkEmail} onChange={(e) => setLinkEmail(e.target.value)} />
        <button className="admin-btn-secondary" disabled={!linkEmail.trim()} onClick={async () => {
          const { error } = await adminLinkClient(partner, linkEmail)
          setMsg(error ? `✗ ${error}` : '✓ Linked'); if (!error) { setLinkEmail(''); void load(); onChanged() }
        }}>Link</button>
        <label className="admin-text-muted" style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 'auto' }}>
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> show ended links
        </label>
      </div>
      {msg && <div className="admin-text-muted" style={{ marginBottom: 8 }}>{msg}</div>}
      <div className="admin-table-wrap">
        <table className="admin-table admin-table-compact">
          <thead><tr><th>Client</th><th>Status</th><th>Discount %</th><th>Commission %</th><th>Consent</th><th>Since</th><th></th></tr></thead>
          <tbody>
            {visible.length === 0 && <tr><td colSpan={7} className="admin-table-empty">No clients.</td></tr>}
            {visible.map((r) => <ClientTermsRow key={r.id} r={r} onSaved={() => { void load(); onChanged() }} />)}
          </tbody>
        </table>
      </div>
      <p className="admin-text-muted" style={{ fontSize: 12 }}>
        Rates are frozen onto each order when it is placed — changing them here affects future orders only. Every change is kept in partner_client_terms_history.
      </p>
    </div>
  )
}

function ClientTermsRow({ r, onSaved }: { r: AdminPartnerClient; onSaved: () => void }) {
  const [d, setD] = useState(String(r.discount_bps / 100))
  const [c, setC] = useState(String(r.commission_bps / 100))
  const [busy, setBusy] = useState(false)
  const dirty = d !== String(r.discount_bps / 100) || c !== String(r.commission_bps / 100)
  async function save(extra?: { status?: string }) {
    setBusy(true)
    const { error } = await updateClientTerms(r.id, {
      discount_bps: Math.round(Number(d.replace(',', '.')) * 100),
      commission_bps: Math.round(Number(c.replace(',', '.')) * 100),
      ...extra,
    })
    setBusy(false)
    if (error) alert(error); else onSaved()
  }
  return (
    <tr className={r.status === 'inactive' ? 'partner-cancelled' : ''}>
      <td><div style={{ fontWeight: 700 }}>{r.name ?? '—'}</div><div className="admin-text-muted" style={{ fontSize: 12 }}>{r.email}</div></td>
      <td>
        {r.status === 'active' && <span className="admin-pill-paid">active</span>}
        {r.status === 'inactive' && <span className="admin-pill-refunded">ended</span>}
        {r.status === 'pending' && (
          <span className="admin-pill-pending">
            pending · {r.client_confirmed_at ? 'client ✓' : 'client ✗'} · {r.approved_at ? 'Fitpal ✓' : 'Fitpal ✗'}
          </span>
        )}
      </td>
      <td><input className="admin-input admin-input-tight" style={{ width: 64 }} value={d} onChange={(e) => setD(e.target.value)} /></td>
      <td><input className="admin-input admin-input-tight" style={{ width: 64 }} value={c} onChange={(e) => setC(e.target.value)} /></td>
      <td>{r.consent_at ? '✓' : '—'}</td>
      <td>{fmtD(r.created_at)}</td>
      <td style={{ whiteSpace: 'nowrap' }}>
        {dirty && <button className="admin-btn-primary admin-btn-sm" disabled={busy} onClick={() => save()}>Save</button>}
        {r.status === 'pending' && !r.approved_at && (
          <button className="admin-btn-secondary admin-btn-sm" disabled={busy} onClick={async () => { await approveLink(r.id); onSaved() }}>Approve</button>
        )}
        {r.status !== 'inactive' && (
          <button className="admin-btn-ghost admin-btn-sm" disabled={busy} onClick={() => { if (window.confirm('End this link? Future orders get no discount/commission.')) void save({ status: 'inactive' }) }}>End</button>
        )}
      </td>
    </tr>
  )
}

function MoneyTab({ partner, onChanged }: { partner: AdminPartner; onChanged: () => void }) {
  const [lines, setLines] = useState<AdminCommissionLine[]>([])
  const [payouts, setPayouts] = useState<AdminPayout[]>([])
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [onlyOpen, setOnlyOpen] = useState(true)
  const [ref, setRef] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  async function load() {
    const [l, p] = await Promise.all([fetchPartnerLines(partner.id), fetchPayouts(partner.id)])
    setLines(l.data); setPayouts(p.data); setSel(new Set())
    if (l.error) setMsg(`✗ ${l.error}`)
  }
  useEffect(() => { void load() }, [partner.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const key = (l: AdminCommissionLine) => `${l.source_type}:${l.source_id}`
  const visible = lines.filter((l) => !onlyOpen || l.outstanding !== 0)
  const selTotal = lines.filter((l) => sel.has(key(l))).reduce((a, l) => a + l.outstanding, 0)
  const owed = lines.reduce((a, l) => a + l.outstanding, 0)

  async function pay(which: AdminCommissionLine[]) {
    if (!which.length) return
    const total = which.reduce((a, l) => a + l.outstanding, 0)
    if (!window.confirm(`Mark ${which.length} line(s) as paid — ${eur(total)}?`)) return
    setBusy(true); setMsg(null)
    const { error } = await markPaid(partner.id, which.map((l) => ({ source_type: l.source_type, source_id: l.source_id })), ref, '')
    setBusy(false)
    if (error) { setMsg(`✗ ${error}`); return }
    setRef(''); setMsg('✓ Payout recorded'); void load(); onChanged()
  }

  return (
    <div>
      <div className="admin-stats-grid">
        <div className="admin-stat-card"><div className="admin-stat-title">Owed now</div><div className="admin-stat-value">{eur(owed)}</div></div>
        <div className="admin-stat-card"><div className="admin-stat-title">Paid out (all time)</div><div className="admin-stat-value">{eur(payouts.reduce((a, p) => a + p.amount, 0))}</div></div>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', margin: '10px 0' }}>
        <input className="admin-input" placeholder="payment reference (bank transfer id…)" value={ref} onChange={(e) => setRef(e.target.value)} />
        <button className="admin-btn-primary" disabled={busy || sel.size === 0} onClick={() => pay(lines.filter((l) => sel.has(key(l))))}>
          Mark selected paid ({eur(selTotal)})
        </button>
        <button className="admin-btn-secondary" disabled={busy || owed === 0} onClick={() => pay(lines.filter((l) => l.outstanding !== 0))}>Mark ALL outstanding paid</button>
        <label className="admin-text-muted" style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 'auto' }}>
          <input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} /> outstanding only
        </label>
      </div>
      {msg && <div className="admin-text-muted" style={{ marginBottom: 8 }}>{msg}</div>}
      <div className="admin-table-wrap">
        <table className="admin-table admin-table-compact">
          <thead><tr><th></th><th>Date</th><th>Client</th><th>Ref</th><th>Amount</th><th>Collected</th><th>%</th><th>Commission</th><th>Paid</th><th>Outstanding</th></tr></thead>
          <tbody>
            {visible.length === 0 && <tr><td colSpan={10} className="admin-table-empty">Nothing here.</td></tr>}
            {visible.map((l) => (
              <tr key={key(l)}>
                <td>{l.outstanding !== 0 && <input type="checkbox" checked={sel.has(key(l))} onChange={(e) => {
                  const n = new Set(sel); if (e.target.checked) n.add(key(l)); else n.delete(key(l)); setSel(n)
                }} />}</td>
                <td>{fmtD(l.occurred_at)}</td>
                <td>{l.client_name}</td>
                <td>{l.ref} <span className="admin-text-muted">{l.payment_method}/{l.payment_status}</span></td>
                <td>{eur(l.gross)}</td>
                <td>{eur(l.base)}</td>
                <td>{pctOf(l.rate_bps)}</td>
                <td>{eur(l.commission)}</td>
                <td>{eur(l.paid_out)}</td>
                <td style={{ fontWeight: 700, color: l.outstanding < 0 ? '#b91c1c' : undefined }}>{eur(l.outstanding)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="admin-text-muted" style={{ fontSize: 12 }}>
        Collected = card/link/cash/transfer money actually received for the order, minus refunds; wallet-paid orders are 0 (commission was earned when the plan was paid).
        A refund after a payout shows as a negative outstanding (clawback).
      </p>
      {payouts.length > 0 && (
        <>
          <div className="admin-section-head" style={{ marginTop: 14 }}><strong>Payouts</strong></div>
          <table className="admin-table admin-table-compact">
            <thead><tr><th>Date</th><th>Amount</th><th>Reference</th></tr></thead>
            <tbody>{payouts.map((p) => <tr key={p.id}><td>{fmtD(p.paid_at)}</td><td>{eur(p.amount)}</td><td>{p.reference ?? ''}</td></tr>)}</tbody>
          </table>
        </>
      )}
    </div>
  )
}
