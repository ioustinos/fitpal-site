/**
 * WEC-841/842 — the dietitian's client list + «Νέος πελάτης».
 * Internal (Fitpal) dietitians also get a search across every customer
 * (🟢 «not limited»).
 */
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchClients, createClientAccount, type ClientRow, eur, pct, fmtDate } from '../api'
import { usePartner } from '../context'
import { sendEmailOtp } from '../../lib/api/auth'
import { PlacesAutocomplete } from '../../components/ui/PlacesAutocomplete'
import { googleMapsAvailable } from '../../lib/googleMaps'
import { supabase } from '../../lib/supabase'

export function Clients() {
  const partner = usePartner()
  const navigate = useNavigate()
  const [rows, setRows] = useState<ClientRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [serverQ, setServerQ] = useState('')
  const [adding, setAdding] = useState(false)

  async function load(search?: string) {
    setLoading(true); setErr(null)
    const { data, error } = await fetchClients(search)
    if (error) setErr(error)
    setRows(data)
    setLoading(false)
  }
  useEffect(() => { void load() }, [])

  // Internal partners search server-side across all customers (debounced).
  useEffect(() => {
    if (!partner.is_internal) return
    const id = window.setTimeout(() => {
      if (q.trim() !== serverQ) { setServerQ(q.trim()); void load(q.trim() || undefined) }
    }, 350)
    return () => window.clearTimeout(id)
  }, [q]) // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    if (partner.is_internal) return rows
    const s = q.trim().toLowerCase()
    if (!s) return rows
    return rows.filter((r) => [r.name, r.email, r.phone].some((v) => (v ?? '').toLowerCase().includes(s)))
  }, [rows, q, partner.is_internal])

  const active = rows.filter((r) => r.status === 'active').length
  const pending = rows.filter((r) => r.status === 'pending').length
  const referralUrl = partner.referral_code ? `${window.location.origin}/ref/${partner.referral_code}` : null

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <h1 className="admin-page-title">Πελάτες</h1>
          <p className="admin-page-sub">
            {partner.is_internal
              ? 'Ομάδα διαιτολόγων Fitpal — αναζήτηση σε όλους τους πελάτες'
              : `${active} ${active === 1 ? 'ενεργός' : 'ενεργοί'}${pending ? ` · ${pending} σε αναμονή` : ''}`}
          </p>
        </div>
        <button className="admin-btn-primary" onClick={() => setAdding(true)}>+ Νέος πελάτης</button>
      </div>

      {referralUrl && (
        <div className="admin-info-banner partner-referral">
          <div>
            <strong>Ο σύνδεσμός σας</strong> — όποιος εγγραφεί από εδώ γίνεται αυτόματα πελάτης σας.
            <div className="partner-mono">{referralUrl}</div>
          </div>
          <div className="partner-referral-actions">
            <button className="admin-btn-secondary admin-btn-sm" onClick={() => navigator.clipboard?.writeText(referralUrl)}>Αντιγραφή</button>
            <a className="admin-btn-secondary admin-btn-sm" target="_blank" rel="noreferrer"
               href={`https://api.qrserver.com/v1/create-qr-code/?size=480x480&data=${encodeURIComponent(referralUrl)}`}>QR</a>
          </div>
        </div>
      )}

      <div className="admin-toolbar" style={{ marginBottom: 12 }}>
        <input className="admin-input" style={{ maxWidth: 360 }} placeholder={partner.is_internal ? 'Αναζήτηση πελάτη (όνομα, email, τηλέφωνο)…' : 'Φίλτρο…'}
               value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {err && <div className="admin-error-banner">{err}</div>}
      {loading ? <div className="admin-loading">Φόρτωση…</div> : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Πελάτης</th>
                <th>Κατάσταση</th>
                {!partner.is_internal && <th>Έκπτωση / Commission</th>}
                <th>Τελ. παραγγελία</th>
                <th>Πορτοφόλι</th>
                <th>Πλάνο έως</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={6} className="admin-table-empty">
                  {partner.is_internal && !q ? 'Γράψτε για αναζήτηση.' : 'Δεν υπάρχουν πελάτες ακόμα.'}
                </td></tr>
              )}
              {filtered.map((r) => {
                const clickable = r.status === 'active' || partner.is_internal
                return (
                  <tr key={r.userId} style={{ cursor: clickable ? 'pointer' : 'default' }}
                      onClick={() => clickable && navigate(`/partner/clients/${r.userId}`)}>
                    <td>
                      <div style={{ fontWeight: 700 }}>{r.name}</div>
                      <div className="admin-text-muted" style={{ fontSize: 12 }}>{r.email}{r.phone ? ` · ${r.phone}` : ''}</div>
                    </td>
                    <td><StatusPill r={r} /></td>
                    {!partner.is_internal && <td>{pct(r.discountBps)} / {pct(r.commissionBps)}</td>}
                    <td>{fmtDate(r.lastOrderAt)}</td>
                    <td>{r.walletBalance != null ? eur(r.walletBalance) : '—'}</td>
                    <td>{fmtDate(r.planActiveUntil)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {adding && (
        <AddClientModal
          onClose={() => setAdding(false)}
          onDone={(userId, status) => {
            setAdding(false)
            void load(partner.is_internal ? serverQ || undefined : undefined)
            if (status === 'active') navigate(`/partner/clients/${userId}`)
          }}
        />
      )}
    </div>
  )
}

function StatusPill({ r }: { r: ClientRow }) {
  if (!r.status) return <span className="admin-pill">Χωρίς σύνδεση</span>
  if (r.status === 'active') {
    return (
      <>
        <span className="admin-pill-paid">Ενεργός</span>
        {r.consent === false && <span className="admin-pill-pending" style={{ marginLeft: 6 }} title="Ο πελάτης δεν έχει δώσει ακόμη συγκατάθεση για τα σωματικά στοιχεία">Χωρίς συγκατάθεση</span>}
      </>
    )
  }
  return (
    <span className="admin-pill-pending" title="Υπάρχων πελάτης της Fitpal">
      {r.needsClientConfirm ? 'Αναμονή αποδοχής πελάτη' : r.needsFitpalApproval ? 'Αναμονή έγκρισης Fitpal' : 'Σε αναμονή'}
    </span>
  )
}

function AddClientModal({ onClose, onDone }: { onClose: () => void; onDone: (userId: string, status: string) => void }) {
  const [f, setF] = useState({ name: '', email: '', phone: '', street: '', area: '', zip: '', floor: '', doorbell: '' })
  const [sendInvite, setSendInvite] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // WEC-869: an existing customer is a WARNING (yellow) that stays until the
  // dietitian closes it — it used to flash green and auto-close after 2.5 s.
  const [warn, setWarn] = useState<{ text: string; userId: string } | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  // WEC-869 (6.4): tell the dietitian while typing that the email already has
  // a Fitpal account. We never prefill that customer's details — that would
  // hand anyone's name/phone/address to whoever types their email.
  const [emailExists, setEmailExists] = useState(false)
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((s) => ({ ...s, [k]: e.target.value }))

  useEffect(() => {
    const email = f.email.trim().toLowerCase()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { setEmailExists(false); return }
    const t = window.setTimeout(async () => {
      const { data } = await supabase.rpc('partner_email_exists', { p_email: email })
      setEmailExists(data === true)
    }, 400)
    return () => window.clearTimeout(t)
  }, [f.email])

  async function submit() {
    setBusy(true); setErr(null); setInfo(null); setWarn(null)
    const res = await createClientAccount({
      email: f.email, name: emailExists ? '' : f.name, phone: emailExists ? '' : f.phone,
      address: emailExists ? {} : { street: f.street, area: f.area, zip: f.zip, floor: f.floor, doorbell: f.doorbell },
    })
    if (res.error || !res.userId) { setBusy(false); setErr(res.error ?? 'Απέτυχε'); return }
    // 🟢 «Ο πελάτης λαμβάνει email για να βάλει κωδικό, αν θέλει» — the
    // normal login-code email, same as admin «Στείλε πρόσκληση».
    if (sendInvite && !res.existing) {
      const inv = await sendEmailOtp(f.email.trim().toLowerCase(), f.name || undefined)
      if (!inv.ok) setInfo(`Ο πελάτης δημιουργήθηκε, αλλά το email σύνδεσης απέτυχε: ${inv.error ?? ''}`)
    }
    setBusy(false)
    if (res.existing && res.status === 'pending') {
      setWarn({ text: res.message ?? 'Ο πελάτης έχει ήδη λογαριασμό. Θα ενεργοποιηθεί όταν αποδεχτεί ο ίδιος και εγκρίνει η Fitpal.', userId: res.userId })
      return
    }
    onDone(res.userId, res.status ?? 'active')
  }

  return (
    <div className="admin-modal-overlay" onClick={onClose}>
      <div className="admin-modal" onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 560, padding: '20px 22px', overflowY: 'auto' }}>
        <h2 style={{ margin: '0 0 14px' }}>Νέος πελάτης</h2>
        <div style={{ display: 'grid', gap: 12 }}>
          <Field label="Email *" value={f.email} onChange={set('email')} type="email" />
          {emailExists && (
            <div style={{ background: '#fffbeb', border: '1px solid #f59e0b', color: '#92400e', borderRadius: 8, padding: '8px 10px', fontSize: 13 }}>
              Αυτό το email έχει ήδη λογαριασμό στη Fitpal. Θα κρατηθούν τα στοιχεία του πελάτη (όνομα, τηλέφωνο, διευθύνσεις)
              και θα γίνει ενεργός όταν αποδεχτεί ο ίδιος και εγκρίνει η Fitpal.
            </div>
          )}
          {!emailExists && (
            <>
              <div className="partner-form-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
                <Field label="Ονοματεπώνυμο" value={f.name} onChange={set('name')} />
                <Field label="Τηλέφωνο" value={f.phone} onChange={set('phone')} />
              </div>
              <label style={{ display: 'block' }}>
                <span className="admin-form-label" style={{ display: 'block', fontSize: 12, marginBottom: 3 }}>Οδός & αριθμός</span>
                {googleMapsAvailable() ? (
                  <PlacesAutocomplete className="admin-input" value={f.street}
                    onChange={(v) => setF((s) => ({ ...s, street: v }))}
                    onSelect={(pl) => setF((s) => ({ ...s, street: pl.street || s.street, area: pl.area || s.area, zip: pl.zip || s.zip }))}
                    placeholder="Ξεκινήστε να γράφετε τη διεύθυνση" country="gr" />
                ) : (
                  <input className="admin-input" style={{ width: '100%' }} value={f.street} onChange={set('street')} />
                )}
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12 }}>
                <Field label="Περιοχή" value={f.area} onChange={set('area')} />
                <Field label="Τ.Κ." value={f.zip} onChange={set('zip')} />
                <Field label="Όροφος" value={f.floor} onChange={set('floor')} />
                <Field label="Κουδούνι" value={f.doorbell} onChange={set('doorbell')} />
              </div>
              <label className="admin-form-checkbox" style={{ display: 'flex', gap: 8 }}>
                <input type="checkbox" checked={sendInvite} onChange={(e) => setSendInvite(e.target.checked)} />
                <span>Αποστολή email σύνδεσης στον πελάτη (για να μπαίνει και μόνος του)</span>
              </label>
            </>
          )}
          <p className="admin-text-muted" style={{ fontSize: 12, margin: 0 }}>
            Ο πελάτης ξεκινά με την έκπτωση της συμφωνίας σας με τη Fitpal. Μπορείτε να την αλλάξετε μετά,
            στην καρτέλα του πελάτη («Έκπτωση πελάτη &amp; commission»).
          </p>
          {err && <div className="admin-error-banner">{err}</div>}
          {warn && (
            <div style={{ background: '#fffbeb', border: '1px solid #f59e0b', color: '#92400e', borderRadius: 8, padding: '10px 12px', fontSize: 14 }}>
              {warn.text}
            </div>
          )}
          {info && <div className="admin-ok-banner">{info}</div>}
        </div>
        <div className="admin-form-actions" style={{ marginTop: 16 }}>
          {warn ? (
            <button className="admin-btn-primary" onClick={() => onDone(warn.userId, 'pending')}>Εντάξει</button>
          ) : (
            <>
              <button className="admin-btn-ghost" onClick={onClose} disabled={busy}>Άκυρο</button>
              <button className="admin-btn-primary" onClick={submit} disabled={busy || !f.email.trim()}>{busy ? 'Αποθήκευση…' : 'Προσθήκη'}</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export function Field({ label, value, onChange, type = 'text', placeholder }: {
  label: string; value: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void; type?: string; placeholder?: string
}) {
  return (
    <label style={{ display: 'block' }}>
      <span className="admin-form-label" style={{ display: 'block', fontSize: 12, marginBottom: 3 }}>{label}</span>
      <input className="admin-input" style={{ width: '100%' }} type={type} value={value} onChange={onChange} placeholder={placeholder} />
    </label>
  )
}
