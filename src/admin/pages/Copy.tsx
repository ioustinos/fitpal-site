import { useEffect, useMemo, useState } from 'react'
import {
  fetchCopyRows, saveCopyOverride, resetCopyOverride, deleteOrphanOverride,
  type CopyRow, type OrphanRow,
} from '../../lib/api/adminCopy'

/**
 * WEC-735 — /admin/copy.
 *
 * Every user-visible string on the ordering site, grouped by the i18n module it
 * lives in, editable without a deploy. Defaults come from the repo; only edited
 * strings get a row in `ui_strings`, and "Επαναφορά" deletes that row.
 *
 * Edits save PER ROW, not through one big form with a Save at the bottom — the
 * team edits one string at a time and a bulk save makes a stray keystroke in an
 * unrelated field shippable.
 */

const MODULE_LABEL: Record<string, string> = {
  common: 'Κοινά (πλοήγηση, ημέρες, φίλτρα)',
  menu: 'Μενού & πιάτα',
  cart: 'Καλάθι & κουπόνια',
  checkout: 'Ολοκλήρωση παραγγελίας',
  account: 'Ο λογαριασμός μου',
  wallet: 'Συνδρομή & πορτοφόλι',
  auth: 'Σύνδεση / εγγραφή',
  errors: 'Μηνύματα σφάλματος',
}

function Row({ row, onChanged }: { row: CopyRow; onChanged: () => void }) {
  const [el, setEl] = useState(row.overrideEl ?? '')
  const [en, setEn] = useState(row.overrideEn ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [ok, setOk] = useState(false)

  useEffect(() => { setEl(row.overrideEl ?? ''); setEn(row.overrideEn ?? '') }, [row.overrideEl, row.overrideEn])

  const overridden = row.overrideEl !== null || row.overrideEn !== null
  const dirty = (el !== (row.overrideEl ?? '')) || (en !== (row.overrideEn ?? ''))

  // A Greek replacement 3x longer than the default fits on desktop and breaks a
  // mobile button. Showing the delta is the cheapest possible warning.
  const lenWarn = (next: string, def: string) => next.length > def.length * 1.6 && next.length > def.length + 12

  async function save() {
    setBusy(true); setErr(null); setOk(false)
    const { error } = await saveCopyOverride(row, el, en)
    setBusy(false)
    if (error) { setErr(error); return }
    setOk(true); onChanged()
    setTimeout(() => setOk(false), 2500)
  }

  async function reset() {
    setBusy(true); setErr(null)
    const { error } = await resetCopyOverride(row)
    setBusy(false)
    if (error) { setErr(error); return }
    setEl(''); setEn(''); onChanged()
  }

  return (
    <div className={`copy-row${overridden ? ' overridden' : ''}`}>
      <div className="copy-row-head">
        <code className="copy-key">{row.key}</code>
        {overridden && <span className="copy-badge">αλλαγμένο</span>}
        {row.updatedBy && (
          <span className="copy-meta">
            {row.updatedBy}
            {row.updatedAt ? ` · ${new Date(row.updatedAt).toLocaleString('el-GR', { dateStyle: 'short', timeStyle: 'short' })}` : ''}
          </span>
        )}
      </div>

      <div className="copy-grid">
        <div className="copy-cell">
          <label className="copy-label">Ελληνικά</label>
          <div className="copy-default" title="Το κείμενο που στέλνει ο κώδικας">{row.defaultEl}</div>
          <textarea
            className="admin-input copy-input"
            rows={2}
            value={el}
            placeholder="(χρησιμοποιείται το προεπιλεγμένο)"
            onChange={(e) => setEl(e.target.value)}
          />
          <div className={`copy-len${lenWarn(el, row.defaultEl) ? ' warn' : ''}`}>
            {el.length ? `${el.length} χαρακτήρες (προεπιλογή ${row.defaultEl.length})` : `προεπιλογή ${row.defaultEl.length} χαρακτήρες`}
            {lenWarn(el, row.defaultEl) && ' — αρκετά μεγαλύτερο, έλεγξέ το σε κινητό'}
          </div>
        </div>

        <div className="copy-cell">
          <label className="copy-label">English</label>
          <div className="copy-default" title="The string the code ships">{row.defaultEn}</div>
          <textarea
            className="admin-input copy-input"
            rows={2}
            value={en}
            placeholder="(uses the default)"
            onChange={(e) => setEn(e.target.value)}
          />
          <div className={`copy-len${lenWarn(en, row.defaultEn) ? ' warn' : ''}`}>
            {en.length ? `${en.length} chars (default ${row.defaultEn.length})` : `default ${row.defaultEn.length} chars`}
            {lenWarn(en, row.defaultEn) && ' — much longer, check on mobile'}
          </div>
        </div>
      </div>

      {err && <div className="copy-err">{err}</div>}

      <div className="copy-actions">
        <button className="admin-btn admin-btn-primary" disabled={!dirty || busy} onClick={save}>
          {busy ? '…' : 'Αποθήκευση'}
        </button>
        {overridden && (
          <button className="admin-btn" disabled={busy} onClick={reset}>Επαναφορά στο αρχικό</button>
        )}
        {ok && <span className="copy-ok">Αποθηκεύτηκε — ζωντανό σε λίγα δευτερόλεπτα</span>}
      </div>
    </div>
  )
}

export function Copy() {
  const [rows, setRows] = useState<CopyRow[]>([])
  const [orphans, setOrphans] = useState<OrphanRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [onlyOverridden, setOnlyOverridden] = useState(false)
  const [openModule, setOpenModule] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    const { rows, orphans, error } = await fetchCopyRows()
    setRows(rows); setOrphans(orphans); setError(error); setLoading(false)
  }
  useEffect(() => { void load() }, [])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return rows.filter((r) => {
      if (onlyOverridden && r.overrideEl === null && r.overrideEn === null) return false
      if (!needle) return true
      // Search the key AND both languages of both the default and the override —
      // nobody looks up «Το καλάθι σου είναι άδειο» by its key name.
      return (
        r.key.toLowerCase().includes(needle) ||
        r.defaultEl.toLowerCase().includes(needle) ||
        r.defaultEn.toLowerCase().includes(needle) ||
        (r.overrideEl ?? '').toLowerCase().includes(needle) ||
        (r.overrideEn ?? '').toLowerCase().includes(needle)
      )
    })
  }, [rows, q, onlyOverridden])

  const grouped = useMemo(() => {
    const m = new Map<string, CopyRow[]>()
    for (const r of filtered) {
      if (!m.has(r.module)) m.set(r.module, [])
      m.get(r.module)!.push(r)
    }
    return [...m.entries()]
  }, [filtered])

  const overriddenCount = rows.filter((r) => r.overrideEl !== null || r.overrideEn !== null).length

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <h1>Κείμενα ιστοσελίδας</h1>
        <div className="admin-text-muted">
          {rows.length} κείμενα · {overriddenCount} αλλαγμένα
        </div>
      </div>

      {/* Agreed before handing over the keys — a bad edit is live in seconds
          with nobody reviewing it. Saying so on the page itself is cheaper than
          saying it once in a meeting. */}
      <div className="copy-warning">
        <strong>Οι αλλαγές είναι ζωντανές μέσα σε δευτερόλεπτα, χωρίς έλεγχο από κανέναν.</strong>{' '}
        Για διορθώσεις και διατύπωση, τέλεια. Για <strong>τιμές, ώρες παράδοσης, «δωρεάν», «εγγύηση»</strong>{' '}
        ή οτιδήποτε αποτελεί υπόσχεση ή έχει νομική σημασία, μίλα πρώτα μαζί μας.
      </div>

      <div className="copy-toolbar">
        <input
          className="admin-input"
          placeholder="Αναζήτηση σε ελληνικά, αγγλικά ή όνομα κλειδιού…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <label className="copy-check">
          <input type="checkbox" checked={onlyOverridden} onChange={(e) => setOnlyOverridden(e.target.checked)} />
          Μόνο τα αλλαγμένα
        </label>
      </div>

      {loading && <div className="admin-text-muted">Φόρτωση…</div>}
      {error && <div className="copy-err">{error}</div>}

      {!loading && grouped.length === 0 && (
        <div className="admin-text-muted">Κανένα κείμενο δεν ταιριάζει με την αναζήτηση.</div>
      )}

      {grouped.map(([mod, list]) => {
        const open = openModule === mod || q.trim().length > 0 || onlyOverridden
        return (
          <section key={mod} className="copy-group">
            <button className="copy-group-head" onClick={() => setOpenModule(open && openModule === mod ? null : mod)}>
              <span>{MODULE_LABEL[mod] ?? mod}</span>
              <span className="admin-text-muted">{list.length}</span>
            </button>
            {open && list.map((r) => <Row key={r.key} row={r} onChanged={() => void load()} />)}
          </section>
        )
      })}

      {orphans.length > 0 && (
        <section className="copy-group">
          <div className="copy-group-head" style={{ cursor: 'default' }}>
            <span>Ορφανά ({orphans.length})</span>
          </div>
          <div className="admin-text-muted" style={{ padding: '0 4px 10px' }}>
            Αλλαγές για κείμενα που δεν υπάρχουν πια στον κώδικα — μετονομάστηκαν ή αφαιρέθηκαν.
            Δεν εμφανίζονται πουθενά· μπορούν να διαγραφούν.
          </div>
          {orphans.map((o) => (
            <div key={o.key} className="copy-row">
              <div className="copy-row-head">
                <code className="copy-key">{o.key}</code>
                {o.updatedBy && <span className="copy-meta">{o.updatedBy}</span>}
              </div>
              <div className="copy-default">{o.valueEl ?? o.valueEn ?? ''}</div>
              <div className="copy-actions">
                <button
                  className="admin-btn"
                  onClick={async () => { await deleteOrphanOverride(o.key); void load() }}
                >
                  Διαγραφή
                </button>
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  )
}

export default Copy
