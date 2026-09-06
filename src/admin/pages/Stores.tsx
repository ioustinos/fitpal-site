/**
 * WEC-715 (B2B-7 — Admin: store CRUD).
 *
 * Until this page existed a storefront could only be created by hand-written
 * SQL. Everything a company or reseller store needs is here: identity, the ONE
 * locked delivery address, the per-store settings that override the platform
 * defaults, the reseller allowlist, and a readiness checklist for the four
 * things that otherwise fail silently.
 *
 * Reuses the two-pane layout classes from the Zones page rather than inventing
 * new ones.
 */

import { useEffect, useState } from 'react'
import {
  fetchAdminStores, createStore, saveStore, setStoreSetting, validateSlug,
  fetchStoreMembers, addStoreMemberByEmail, removeStoreMember,
  cloneLatestRetailWeek, storeReadiness,
  type AdminStore, type StoreMember,
} from '../../lib/api/adminStores'

const PAYMENT_METHODS = ['cash', 'card', 'link', 'transfer', 'wallet'] as const

export function Stores() {
  const [stores, setStores] = useState<AdminStore[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const [newSlug, setNewSlug] = useState('')
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState<'company' | 'reseller'>('company')
  const [cloneMenu, setCloneMenu] = useState(true)
  const [creating, setCreating] = useState(false)

  async function refresh(keepId?: string | null) {
    setLoading(true); setErr(null)
    const { data, error } = await fetchAdminStores()
    if (error) setErr(error)
    setStores(data ?? [])
    if (keepId !== undefined) setSelectedId(keepId)
    else if (!selectedId && (data?.length ?? 0) > 0) setSelectedId(data!.find((s) => !s.isDefault)?.id ?? data![0].id)
    setLoading(false)
  }

  useEffect(() => { void refresh() }, [])

  const selected = stores.find((s) => s.id === selectedId) ?? null
  const slugError = newSlug ? validateSlug(newSlug, stores) : null

  async function handleCreate() {
    if (!newSlug.trim() || slugError) return
    setCreating(true); setErr(null); setNote(null)
    const { data, error, menuCloned } = await createStore({
      slug: newSlug, type: newType,
      nameEl: newName || newSlug, nameEn: newName || newSlug,
      cloneLatestMenu: cloneMenu,
    })
    setCreating(false)
    if (error) { setErr(error); return }
    setNewSlug(''); setNewName('')
    setNote(
      menuCloned
        ? `Store created. The newest active retail week was cloned into it — edit it under Menu builder.`
        : `Store created. No menu was cloned (no active retail week found) — the store has an empty menu until you clone one.`,
    )
    await refresh(data?.id ?? null)
  }

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <h1 className="admin-page-title">Stores</h1>
          <p className="admin-page-sub">
            {stores.length} storefront{stores.length === 1 ? '' : 's'} — the retail site plus every company and reseller portal.
          </p>
        </div>
      </div>

      {err && <div className="admin-error-banner">{err}</div>}
      {note && <div className="admin-info-banner" style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', color: '#065f46', padding: '10px 14px', borderRadius: 8, marginBottom: 12, fontSize: 13 }}>{note}</div>}
      {loading && <div className="admin-loading">Loading…</div>}

      {!loading && (
        <div className="admin-zones-layout">
          <aside className="admin-zones-list">
            {stores.map((s) => (
              <button
                key={s.id}
                className={`admin-zone-item${selectedId === s.id ? ' selected' : ''}${!s.active ? ' inactive' : ''}`}
                onClick={() => { setSelectedId(s.id); setNote(null) }}
              >
                <div className="admin-zone-item-name">
                  {s.nameEl}{s.isDefault && <span style={{ fontWeight: 600, color: '#6b7280' }}> · retail</span>}
                </div>
                <div className="admin-zone-item-meta">
                  /{s.slug} · {s.type} · {s.menus.length} menu{s.menus.length === 1 ? '' : 's'}
                  {s.type === 'reseller' && <> · {s.memberCount} member{s.memberCount === 1 ? '' : 's'}</>}
                  {!s.active && <> · <em>inactive</em></>}
                </div>
                {!s.isDefault && storeReadiness(s).some((r) => !r.ok) && (
                  <div style={{ color: '#dc2626', fontWeight: 700, fontSize: 11, marginTop: 3, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                    Setup incomplete
                  </div>
                )}
              </button>
            ))}

            <div className="admin-inline-form" style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', color: '#6b7280', letterSpacing: '.04em' }}>
                New store
              </div>
              <input className="admin-input" placeholder="URL slug, e.g. acme" value={newSlug}
                     onChange={(e) => setNewSlug(e.target.value.toLowerCase())} />
              {slugError && <div style={{ color: '#dc2626', fontSize: 11 }}>{slugError}</div>}
              {newSlug && !slugError && (
                <div style={{ color: '#6b7280', fontSize: 11 }}>orders.fitpal.gr/{newSlug}</div>
              )}
              <input className="admin-input" placeholder="Company name" value={newName}
                     onChange={(e) => setNewName(e.target.value)} />
              <select className="admin-input" value={newType} onChange={(e) => setNewType(e.target.value as 'company' | 'reseller')}>
                <option value="company">Company portal — open to anyone with the URL</option>
                <option value="reseller">Reseller portal — invited users only</option>
              </select>
              <label style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="checkbox" checked={cloneMenu} onChange={(e) => setCloneMenu(e.target.checked)} />
                Clone the newest active retail week into it
              </label>
              <button className="admin-btn-primary" onClick={handleCreate} disabled={!newSlug.trim() || !!slugError || creating}>
                {creating ? 'Creating…' : '+ Create store'}
              </button>
            </div>
          </aside>

          <div className="admin-zones-editor">
            {selected
              ? <StoreEditor key={selected.id} store={selected} onSaved={() => refresh(selected.id)} />
              : <div className="admin-text-muted" style={{ padding: 40, textAlign: 'center' }}>Pick a store, or create one.</div>}
          </div>
        </div>
      )}
    </div>
  )
}

function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 26 }}>
      <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em', color: '#6b7280', marginBottom: 2 }}>
        {title}
      </div>
      {sub && <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 8 }}>{sub}</div>}
      <div style={{ display: 'grid', gap: 8 }}>{children}</div>
    </div>
  )
}

function Field({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string
}) {
  return (
    <label style={{ display: 'grid', gap: 3 }}>
      <span style={{ fontSize: 12, color: '#374151', fontWeight: 600 }}>{label}</span>
      <input className="admin-input" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  )
}

function StoreEditor({ store, onSaved }: { store: AdminStore; onSaved: () => void }) {
  const [form, setForm] = useState({
    nameEl: store.nameEl, nameEn: store.nameEn,
    accentColor: store.accentColor ?? '', logoUrl: store.logoUrl ?? '',
    banner1El: store.banner1El ?? '', banner1En: store.banner1En ?? '',
    addressStreet: store.addressStreet ?? '', addressArea: store.addressArea ?? '',
    addressZip: store.addressZip ?? '', addressFloor: store.addressFloor ?? '',
    addressDoorbell: store.addressDoorbell ?? '', addressNotes: store.addressNotes ?? '',
    airtableStoreId: store.airtableStoreId != null ? String(store.airtableStoreId) : '',
  })
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const s = store.settings
  const [minOrder, setMinOrder] = useState(typeof s.min_order === 'number' ? String((s.min_order as number) / 100) : '')
  const [benefit, setBenefit] = useState(typeof s.company_benefit === 'number' ? String((s.company_benefit as number) / 100) : '')
  const [cutoffHour, setCutoffHour] = useState(typeof s.cutoff_hour === 'number' ? String(s.cutoff_hour) : '')
  const [windows, setWindows] = useState(Array.isArray(s.time_slots) ? (s.time_slots as string[]).join(', ') : '')
  const [methods, setMethods] = useState<string[]>(() => {
    const raw = s.payment_methods_enabled
    if (Array.isArray(raw)) return raw as string[]
    if (raw && typeof raw === 'object') {
      return Object.entries(raw as Record<string, { public?: boolean }>)
        .filter(([, v]) => v?.public === true).map(([k]) => k)
    }
    return []
  })
  const hasMethodOverride = s.payment_methods_enabled !== undefined

  const readiness = storeReadiness(store)
  const isRetail = store.isDefault

  async function handleSave() {
    setSaving(true); setMsg(null)
    const { error } = await saveStore(store.id, {
      nameEl: form.nameEl, nameEn: form.nameEn,
      accentColor: form.accentColor || null, logoUrl: form.logoUrl || null,
      banner1El: form.banner1El || null, banner1En: form.banner1En || null,
      addressStreet: form.addressStreet || null, addressArea: form.addressArea || null,
      addressZip: form.addressZip || null, addressFloor: form.addressFloor || null,
      addressDoorbell: form.addressDoorbell || null, addressNotes: form.addressNotes || null,
      airtableStoreId: form.airtableStoreId ? Number(form.airtableStoreId) : null,
    })
    if (!error) {
      // Settings are stored in cents / raw jsonb, exactly as the customer site
      // and the server read them.
      await setStoreSetting(store.id, 'min_order', minOrder ? Math.round(Number(minOrder) * 100) : null)
      await setStoreSetting(store.id, 'company_benefit', benefit ? Math.round(Number(benefit) * 100) : null)
      await setStoreSetting(store.id, 'cutoff_hour', cutoffHour ? Number(cutoffHour) : null)
      await setStoreSetting(store.id, 'time_slots',
        windows.trim() ? windows.split(',').map((w) => w.trim()).filter(Boolean) : null)
      await setStoreSetting(store.id, 'payment_methods_enabled',
        methods.length > 0
          ? Object.fromEntries(PAYMENT_METHODS.map((m) => [m, { public: methods.includes(m), admin: methods.includes(m) }]))
          : null)
    }
    setSaving(false)
    setMsg(error ?? 'Saved.')
    onSaved()
  }

  return (
    <div style={{ padding: 18, maxWidth: 720 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 }}>
        <h2 style={{ margin: 0, fontSize: 20 }}>{store.nameEl}</h2>
        <code style={{ fontSize: 12, color: '#6b7280' }}>orders.fitpal.gr/{store.slug}</code>
      </div>
      <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 18 }}>
        {store.type}{store.isDefault && ' · the retail store'} · {store.active ? 'active' : 'inactive'}
      </div>

      {!isRetail && (
        <Section title="Setup checklist" sub="These four fail silently if skipped — the symptom is a customer who cannot order.">
          {readiness.map((r) => (
            <div key={r.key} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13 }}>
              <span style={{ color: r.ok ? '#059669' : '#dc2626', fontWeight: 900 }}>{r.ok ? '✓' : '✗'}</span>
              <span>
                <strong>{r.label}</strong>
                {!r.ok && <span style={{ color: '#6b7280' }}> — {r.hint}</span>}
              </span>
            </div>
          ))}
        </Section>
      )}

      <Section title="Identity">
        <Field label="Name (EL)" value={form.nameEl} onChange={(v) => setForm({ ...form, nameEl: v })} />
        <Field label="Name (EN)" value={form.nameEn} onChange={(v) => setForm({ ...form, nameEn: v })} />
        <Field label="Accent colour" value={form.accentColor} onChange={(v) => setForm({ ...form, accentColor: v })} placeholder="#00b96b" />
        <Field label="Logo URL" value={form.logoUrl} onChange={(v) => setForm({ ...form, logoUrl: v })} />
        <Field label="Banner (EL)" value={form.banner1El} onChange={(v) => setForm({ ...form, banner1El: v })} />
        <Field label="Banner (EN)" value={form.banner1En} onChange={(v) => setForm({ ...form, banner1En: v })} />
      </Section>

      {!isRetail && (
        <Section title="Delivery address" sub="ONE address. Every order on this store is delivered here, and a customer's own saved address never overrides it.">
          <Field label="Street" value={form.addressStreet} onChange={(v) => setForm({ ...form, addressStreet: v })} />
          <Field label="Area" value={form.addressArea} onChange={(v) => setForm({ ...form, addressArea: v })} />
          <Field label="Postcode" value={form.addressZip} onChange={(v) => setForm({ ...form, addressZip: v })} />
          <Field label="Floor" value={form.addressFloor} onChange={(v) => setForm({ ...form, addressFloor: v })} />
          <Field label="Doorbell" value={form.addressDoorbell} onChange={(v) => setForm({ ...form, addressDoorbell: v })} />
          <Field label="Notes for the driver" value={form.addressNotes} onChange={(v) => setForm({ ...form, addressNotes: v })} />
          <div style={{ fontSize: 12, color: '#6b7280' }}>
            A store address is treated as in-zone by definition — it may sit outside every retail delivery zone.
          </div>
        </Section>
      )}

      {!isRetail && (
        <Section title="Store settings" sub="Leave a field empty to inherit the platform default.">
          <Field label="Minimum order per day (€)" value={minOrder} onChange={setMinOrder} placeholder="inherits retail" />
          {store.type === 'company' && (
            <Field label="Company benefit per delivery day (€)" value={benefit} onChange={setBenefit} placeholder="0 — no benefit" />
          )}
          <Field label="Cutoff hour (0–23)" value={cutoffHour} onChange={setCutoffHour} placeholder="inherits retail" />
          <Field label="Delivery window(s)" value={windows} onChange={setWindows} placeholder="12:00-14:00" />
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: -4 }}>
            Comma-separated. One window = a fixed slot; the customer sees only that.
          </div>
          <div>
            <span style={{ fontSize: 12, color: '#374151', fontWeight: 600 }}>Payment methods</span>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 4 }}>
              {PAYMENT_METHODS.map((m) => (
                <label key={m} style={{ fontSize: 13, display: 'flex', gap: 4, alignItems: 'center' }}>
                  <input type="checkbox" checked={methods.includes(m)}
                         onChange={(e) => setMethods(e.target.checked ? [...methods, m] : methods.filter((x) => x !== m))} />
                  {m}
                </label>
              ))}
            </div>
            {!hasMethodOverride && methods.length === 0 && (
              <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>None selected — inherits the retail methods.</div>
            )}
          </div>
          <Field label="Airtable Store Id" value={form.airtableStoreId} onChange={(v) => setForm({ ...form, airtableStoreId: v })} placeholder="9001" />
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: -4 }}>
            Retail is 9999. Give each store its own number and add the matching row in Airtable.
          </div>
        </Section>
      )}

      {!isRetail && <MenusSection store={store} onChanged={onSaved} />}
      {store.type === 'reseller' && <MembersSection storeId={store.id} onChanged={onSaved} />}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 8 }}>
        <button className="admin-btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        {!isRetail && (
          <button
            className="admin-btn"
            onClick={async () => { await saveStore(store.id, { active: !store.active }); onSaved() }}
          >
            {store.active ? 'Deactivate store' : 'Activate store'}
          </button>
        )}
        {msg && <span style={{ fontSize: 12, color: msg === 'Saved.' ? '#059669' : '#dc2626' }}>{msg}</span>}
      </div>
    </div>
  )
}

function MenusSection({ store, onChanged }: { store: AdminStore; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const today = new Date().toISOString().slice(0, 10)

  return (
    <Section title="Weekly menus" sub="This store owns these outright. Cloning is a one-time copy — later edits to the retail menu never reach it.">
      {store.menus.length === 0 && <div style={{ fontSize: 13, color: '#dc2626' }}>No menu yet — nothing can be ordered here.</div>}
      {store.menus.map((m) => (
        <div key={m.id} style={{ fontSize: 13, display: 'flex', gap: 8 }}>
          <span style={{ color: m.toDate >= today ? '#111827' : '#9ca3af' }}>{m.fromDate} → {m.toDate}</span>
          <span style={{ color: '#6b7280' }}>{m.name}</span>
          {!m.active && <em style={{ color: '#9ca3af' }}>inactive</em>}
        </div>
      ))}
      <div>
        <button className="admin-btn" disabled={busy} onClick={async () => {
          setBusy(true); setMsg(null)
          const { cloned, error } = await cloneLatestRetailWeek(store.id, store.nameEl)
          setBusy(false)
          setMsg(cloned ? 'Cloned the newest active retail week.' : (error ?? 'Nothing to clone.'))
          onChanged()
        }}>
          {busy ? 'Cloning…' : 'Clone newest retail week into this store'}
        </button>
        {msg && <span style={{ fontSize: 12, marginLeft: 8, color: '#6b7280' }}>{msg}</span>}
      </div>
    </Section>
  )
}

function MembersSection({ storeId, onChanged }: { storeId: string; onChanged: () => void }) {
  const [members, setMembers] = useState<StoreMember[]>([])
  const [email, setEmail] = useState('')
  const [msg, setMsg] = useState<string | null>(null)

  async function load() {
    const { data } = await fetchStoreMembers(storeId)
    setMembers(data ?? [])
  }
  useEffect(() => { void load() }, [storeId])

  return (
    <Section title="Who can order here" sub="A reseller portal is invite-only. Anyone not on this list is refused, even with the URL.">
      {members.length === 0 && <div style={{ fontSize: 13, color: '#dc2626' }}>No members yet — nobody can order.</div>}
      {members.map((m) => (
        <div key={m.userId} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
          <span>{m.name ?? '—'}</span>
          <span style={{ color: '#6b7280' }}>{m.email}</span>
          <button className="admin-btn-link" style={{ color: '#dc2626', fontSize: 12 }}
                  onClick={async () => { await removeStoreMember(storeId, m.userId); await load(); onChanged() }}>
            Remove
          </button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 6 }}>
        <input className="admin-input" placeholder="customer@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        <button className="admin-btn" onClick={async () => {
          const { error } = await addStoreMemberByEmail(storeId, email)
          setMsg(error); if (!error) { setEmail(''); await load(); onChanged() }
        }}>Add</button>
      </div>
      {msg && <div style={{ fontSize: 12, color: '#dc2626' }}>{msg}</div>}
    </Section>
  )
}
