/**
 * WEC-842 — the CLIENT's side of the dietitian link.
 *
 *  • An existing Fitpal customer whom a dietitian added (or who arrived via a
 *    referral link while already a customer) is linked as 'pending' until they
 *    confirm here AND Fitpal approves. 🟢 Ioustinos: existing customers can be
 *    added «but must confirm by email + Fitpal approves». The confirmation is
 *    this in-site prompt shown after they log in — logging in with the email
 *    code IS the proof they own the email. (🔵 my implementation choice; an
 *    outbound confirmation email was not built tonight.)
 *  • 🟢 Health-data consent: a checkbox to share body data / targets with the
 *    dietitian. Without it the dietitian still orders and sets targets but does
 *    not see weight/height etc.
 *
 * Also WEC-852 (hidden add-on): /ref/<code> stores the code; once the visitor
 * is signed in we claim it. The server ignores codes of partners that don't
 * have the referral add-on switched on.
 *
 * Never shown while someone is impersonating — the dietitian must not be able
 * to click «accept» on the client's behalf.
 */
import { useEffect, useState } from 'react'
import { usePartnerLink, usePartnerLinkStore } from '../../lib/partner/usePartnerLink'
import { useImpersonationStore } from '../../store/useImpersonationStore'
import { useAuthStore } from '../../store/useAuthStore'
import { useUIStore } from '../../store/useUIStore'
import { supabase } from '../../lib/supabase'

export const REF_STORAGE_KEY = 'fitpal_partner_ref'

export function PartnerLinkPrompt() {
  const link = usePartnerLink()
  const impersonating = useImpersonationStore((s) => s.active)
  const user = useAuthStore((s) => s.user)
  const lang = useUIStore((s) => s.lang)
  const el = lang === 'el'
  const [consent, setConsent] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState(false)

  // WEC-852: claim a stored referral code once signed in.
  useEffect(() => {
    if (!user || impersonating) return
    let code: string | null = null
    try { code = localStorage.getItem(REF_STORAGE_KEY) } catch { /* private mode */ }
    if (!code) return
    void (async () => {
      const { data, error } = await supabase.rpc('claim_partner_referral', { p_code: code })
      // Whatever the answer (claimed, unknown code, already linked) the code
      // has been used up — don't retry on every page.
      try { localStorage.removeItem(REF_STORAGE_KEY) } catch { /* ignore */ }
      if (!error && (data as { ok?: boolean } | null)?.ok) {
        await usePartnerLinkStore.getState().load(true)
      }
    })()
  }, [user, impersonating])

  if (!user || impersonating || dismissed || !link) return null
  const mustConfirm = link.needsConfirm
  const mustConsent = !mustConfirm && link.status === 'active' && link.needsConsent
  if (!mustConfirm && !mustConsent) return null

  async function answer(accept: boolean) {
    setBusy(true); setErr(null)
    const { error } = await usePartnerLinkStore.getState().respond(accept, accept && consent)
    setBusy(false)
    if (error) setErr(error)
    else if (!accept) setDismissed(true)
  }

  return (
    <div role="dialog" aria-live="polite" style={{
      position: 'fixed', left: 16, right: 16, bottom: 16, zIndex: 900, maxWidth: 520, margin: '0 auto',
      background: 'var(--surface, #fff)', color: 'var(--text, #1a1a1a)', borderRadius: 14,
      boxShadow: '0 12px 40px rgba(0,0,0,.18)', padding: '18px 18px 14px', border: '1px solid rgba(0,0,0,.06)',
    }}>
      <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 6 }}>
        {mustConfirm
          ? (el ? `Ο/Η διαιτολόγος ${link.partnerName} σας πρόσθεσε στους πελάτες του/της` : `Dietitian ${link.partnerName} added you as a client`)
          : (el ? `Συγκατάθεση για τον/την διαιτολόγο ${link.partnerName}` : `Consent for your dietitian ${link.partnerName}`)}
      </div>
      <div style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--text-muted, #555)', marginBottom: 10 }}>
        {mustConfirm
          ? (el ? 'Αν το αποδεχτείτε, ο/η διαιτολόγος θα μπορεί να βλέπει τις παραγγελίες σας, να ορίζει στόχους και να παραγγέλνει για εσάς.'
                : 'If you accept, your dietitian can see your orders, set your targets and place orders for you.')
          : (el ? 'Ο/Η διαιτολόγος σας μπορεί να βλέπει τα σωματικά σας στοιχεία (ύψος, βάρος, μετρήσεις) μόνο με τη συγκατάθεσή σας.'
                : 'Your dietitian can see your body data (height, weight, measurements) only with your consent.')}
      </div>
      <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, marginBottom: 12 }}>
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ marginTop: 3 }} />
        <span>{el ? 'Συμφωνώ να μοιράζομαι τα σωματικά μου στοιχεία και τους στόχους μου με τον/την διαιτολόγο μου.'
                  : 'I agree to share my body data and targets with my dietitian.'}</span>
      </label>
      {err && <div style={{ color: '#b91c1c', fontSize: 12, marginBottom: 8 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        {mustConfirm ? (
          <>
            <button className="btn-secondary" disabled={busy} onClick={() => answer(false)}>{el ? 'Απόρριψη' : 'Decline'}</button>
            <button className="btn-primary" disabled={busy} onClick={() => answer(true)}>{el ? 'Αποδοχή' : 'Accept'}</button>
          </>
        ) : (
          <>
            <button className="btn-secondary" disabled={busy} onClick={() => setDismissed(true)}>{el ? 'Αργότερα' : 'Later'}</button>
            <button className="btn-primary" disabled={busy || !consent} onClick={() => answer(true)}>{el ? 'Συμφωνώ' : 'I agree'}</button>
          </>
        )}
      </div>
    </div>
  )
}
