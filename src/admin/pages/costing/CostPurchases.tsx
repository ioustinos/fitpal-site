import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  attachmentUrl, deleteInvoice, fetchCostItemOptions, fetchInvoice, fetchInvoices, fetchPricesAt, fetchSuppliers,
  saveCostItem, saveInvoice, saveSupplier, uploadInvoiceAttachment,
} from '../../../lib/api/adminCosting'
import type {
  CostItemOption, CostSource, InvoiceHeader, InvoiceLine, InvoiceListRow, SupplierRow,
} from '../../../lib/api/adminCosting'
import {
  CostingTabs, NumText, SearchPick, fmtDate, fmtEur, fmtUnitCost, todayAthens, useUrlState,
} from '../../costing/shared'
import type { PickOption } from '../../costing/shared'

/**
 * /admin/costing/purchases — WEC-863 (Costing 6: purchase invoices, multi-line
 * entry, attachment, totals check). One invoice = header + many lines; prices
 * are typed by hand for now (AI parsing later fills the same shape).
 */

const PAGE = 300

// ── helpers ──────────────────────────────────────────────────────────────────
type PrevPrice = { unit_cost: number; source: CostSource; price_date?: string }

interface DraftLine {
  k: string
  id?: string
  cost_item_id: string | null
  qty_packs: number | null
  pack_label: string
  base_qty_per_pack: number | null
  net_price_per_pack: number | null
  /** fraction, 0.13 = 13% */
  vat_rate: number | null
  exclude_from_costing: boolean
  note: string | null
}

let keySeq = 0
const newKey = () => `l${++keySeq}`
const blankLine = (): DraftLine => ({
  k: newKey(), cost_item_id: null, qty_packs: null, pack_label: '', base_qty_per_pack: null,
  net_price_per_pack: null, vat_rate: null, exclude_from_costing: false, note: null,
})
const isBlank = (l: DraftLine) => !l.cost_item_id && l.qty_packs === null && l.net_price_per_pack === null
const round = (v: number, d = 4) => Math.round(v * 10 ** d) / 10 ** d
const UNIT_LABEL: Record<string, string> = { g: 'g', ml: 'ml', pcs: 'pcs' }

function lineMoney(l: DraftLine) {
  const net = (l.qty_packs ?? 0) * (l.net_price_per_pack ?? 0)
  const vat = net * (l.vat_rate ?? 0)
  return { net, vat }
}

function ClipIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ verticalAlign: 'middle' }}>
      <path d="M21.4 11.1l-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5" />
    </svg>
  )
}

async function openAttachment(path: string, onError: (e: string) => void) {
  // open synchronously (popup blockers), then point it at the signed URL
  const w = window.open('', '_blank')
  const res = await attachmentUrl(path)
  if (res.error || !res.data) { w?.close(); onError(res.error ?? 'Could not open attachment'); return }
  if (w) w.location.href = res.data; else window.location.href = res.data
}

// ── page ─────────────────────────────────────────────────────────────────────
export function CostPurchases() {
  const [supplierF, setSupplierF] = useUrlState('supplier')
  const [fromF, setFromF] = useUrlState('from')
  const [toF, setToF] = useUrlState('to')
  const [openInv, setOpenInv] = useUrlState('inv')
  const [, setSp] = useSearchParams()
  const clearFilters = () => setSp((p) => {
    const n = new URLSearchParams(p); n.delete('supplier'); n.delete('from'); n.delete('to'); return n
  }, { replace: true })

  const [rows, setRows] = useState<InvoiceListRow[]>([])
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([])
  const [items, setItems] = useState<CostItemOption[]>([])
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [limit, setLimit] = useState(PAGE)
  const [listTick, setListTick] = useState(0)
  const [supTick, setSupTick] = useState(0)
  const listKey = `${supplierF}|${fromF}|${toF}|${listTick}`
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  const loading = loadedKey !== listKey

  useEffect(() => {
    let alive = true
    fetchInvoices({ supplierId: supplierF || null, from: fromF || null, to: toF || null }).then((res) => {
      if (!alive) return
      setLoadedKey(listKey)
      if (res.error) { setError(res.error); return }
      setRows(res.data ?? [])
    })
    return () => { alive = false }
  }, [listKey, supplierF, fromF, toF])

  useEffect(() => {
    let alive = true
    fetchSuppliers().then((res) => {
      if (!alive) return
      if (res.error) { setError(res.error); return }
      setSuppliers(res.data ?? [])
    })
    return () => { alive = false }
  }, [supTick])

  useEffect(() => {
    let alive = true
    fetchCostItemOptions().then((res) => {
      if (!alive) return
      if (res.error) { setError(res.error); return }
      setItems(res.data ?? [])
    })
    return () => { alive = false }
  }, [])

  const totals = useMemo(() => rows.reduce((a, r) => ({
    net: a.net + Number(r.net || 0), vat: a.vat + Number(r.vat || 0), gross: a.gross + Number(r.gross || 0),
  }), { net: 0, vat: 0, gross: 0 }), [rows])

  const supplierName = suppliers.find((s) => s.id === supplierF)?.name

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <h1 className="admin-page-title">Purchases</h1>
          <p className="admin-page-sub">Supplier invoices. Each line sets the item's price from the invoice date onwards.</p>
        </div>
        <div className="admin-page-actions">
          <button className="admin-btn admin-btn-primary admin-btn-sm" onClick={() => { setInfo(null); setOpenInv('new') }}>+ New invoice</button>
        </div>
      </div>
      <CostingTabs />

      {error && <div className="admin-error-banner" style={{ marginBottom: 10 }}>{error} <button className="admin-btn admin-btn-ghost admin-btn-sm" onClick={() => setError(null)}>×</button></div>}
      {info && <div className="admin-info-banner" style={{ marginBottom: 10 }}>{info}</div>}

      <div className="cst-toolbar">
        <label>Supplier
          <select className="admin-input" value={supplierF} onChange={(e) => setSupplierF(e.target.value)} style={{ minWidth: 180 }}>
            <option value="">All suppliers</option>
            {supplierF && !supplierName && <option value={supplierF}>(selected supplier)</option>}
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label>From <input type="date" className="admin-input" value={fromF} onChange={(e) => setFromF(e.target.value)} /></label>
        <label>To <input type="date" className="admin-input" value={toF} onChange={(e) => setToF(e.target.value)} /></label>
        {(supplierF || fromF || toF) && (
          <button className="admin-btn admin-btn-ghost admin-btn-sm" onClick={clearFilters}>Clear filters</button>
        )}
        <div className="cst-spacer" />
        <span className="cst-count">{rows.length} invoices · net {fmtEur(totals.net)} · gross {fmtEur(totals.gross)}</span>
      </div>

      {loading && !rows.length ? <div className="admin-loading">Loading…</div> : !rows.length ? (
        <div className="admin-empty">No invoices{supplierF || fromF || toF ? ' for these filters' : ' yet — add the first one with «New invoice»'}.</div>
      ) : (
        <div className="cst-wrap">
          <table className="cst-table">
            <thead>
              <tr>
                <th>Date</th><th>Supplier</th><th>Number</th><th className="num">Lines</th>
                <th className="num">Net</th><th className="num">VAT</th><th className="num">Gross</th><th title="Attachment"><ClipIcon /></th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, limit).map((r) => (
                <tr key={r.id} className="cst-click" onClick={() => { setInfo(null); setOpenInv(r.id) }}>
                  <td>{fmtDate(r.invoice_date)}</td>
                  <td>{r.supplier ?? <span className="cst-muted">—</span>}</td>
                  <td>{r.invoice_number ?? <span className="cst-muted">—</span>}</td>
                  <td className="num">{r.lines}</td>
                  <td className="num">{fmtEur(r.net)}</td>
                  <td className="num">{fmtEur(r.vat)}</td>
                  <td className="num cst-strong">{fmtEur(r.gross)}</td>
                  <td>
                    {r.attachment_path && (
                      <a href="#" title="View attachment" onClick={(e) => {
                        e.preventDefault(); e.stopPropagation()
                        void openAttachment(r.attachment_path as string, setError)
                      }}><ClipIcon /></a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > limit && (
            <div style={{ padding: 8, textAlign: 'center' }}>
              <button className="admin-btn admin-btn-ghost admin-btn-sm" onClick={() => setLimit((l) => l + PAGE)}>Show more ({rows.length - limit})</button>
            </div>
          )}
        </div>
      )}

      {openInv && (
        <InvoiceEditor
          key={openInv}
          invoiceId={openInv === 'new' ? null : openInv}
          defaultSupplier={openInv === 'new' ? (supplierF || null) : null}
          suppliers={suppliers}
          items={items}
          onItemCreated={(it) => setItems((prev) => [...prev, it].sort((a, b) => a.name.localeCompare(b.name, 'el')))}
          onSupplierCreated={() => setSupTick((t) => t + 1)}
          onClose={() => setOpenInv('')}
          onSaved={(msg) => { setOpenInv(''); setInfo(msg); setListTick((t) => t + 1) }}
        />
      )}
    </div>
  )
}

// ── editor ───────────────────────────────────────────────────────────────────
function InvoiceEditor({ invoiceId, defaultSupplier, suppliers, items, onItemCreated, onSupplierCreated, onClose, onSaved }: {
  invoiceId: string | null
  defaultSupplier: string | null
  suppliers: SupplierRow[]
  items: CostItemOption[]
  onItemCreated: (it: CostItemOption) => void
  onSupplierCreated: () => void
  onClose: () => void
  onSaved: (msg: string) => void
}) {
  const [loading, setLoading] = useState(!!invoiceId)
  const [header, setHeader] = useState<InvoiceHeader>({
    supplier_id: defaultSupplier, invoice_date: todayAthens(), invoice_number: null, attachment_path: null, notes: null,
  })
  const [lines, setLines] = useState<DraftLine[]>(() => [blankLine()])
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const [prev, setPrev] = useState<Record<string, PrevPrice>>({})
  const [err, setErr] = useState<string | null>(null)
  const [headErr, setHeadErr] = useState<string | null>(null)
  const [lineErr, setLineErr] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const dirty = useRef(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])
  const itemOptions = useMemo<PickOption[]>(() => items.map((i) => ({
    id: i.id, label: i.name,
    hint: `${UNIT_LABEL[i.base_unit] ?? i.base_unit}${i.kind === 'packaging' ? ' · packaging' : ''}${i.active ? '' : ' · inactive'}`,
  })), [items])
  const supplierOptions = useMemo<PickOption[]>(() => suppliers.map((s) => ({
    id: s.id, label: s.name, hint: s.vat_number ?? undefined,
  })), [suppliers])

  // load an existing invoice
  useEffect(() => {
    if (!invoiceId) return
    let alive = true
    void (async () => {
      const res = await fetchInvoice(invoiceId)
      if (!alive) return
      setLoading(false)
      if (res.error || !res.data) { setErr(res.error ?? 'Invoice not found'); return }
      const h = res.data.header
      setHeader({
        id: h.id, supplier_id: h.supplier_id, invoice_date: h.invoice_date, invoice_number: h.invoice_number,
        attachment_path: h.attachment_path, notes: h.notes,
      })
      const ls = res.data.lines.map((l): DraftLine => ({
        k: newKey(), id: l.id, cost_item_id: l.cost_item_id, qty_packs: l.qty_packs, pack_label: l.pack_label ?? '',
        base_qty_per_pack: l.base_qty_per_pack, net_price_per_pack: l.net_price_per_pack, vat_rate: l.vat_rate,
        exclude_from_costing: l.exclude_from_costing, note: l.note,
      }))
      setLines(ls.length ? ls : [blankLine()])
    })()
    return () => { alive = false }
  }, [invoiceId])

  // previous price of each item on the invoice date (ignoring this invoice)
  const priceKey = useMemo(() => {
    const ids = [...new Set(lines.map((l) => l.cost_item_id).filter((x): x is string => !!x))].sort()
    return ids.length && header.invoice_date ? `${header.invoice_date}|${ids.join(',')}` : ''
  }, [lines, header.invoice_date])
  useEffect(() => {
    if (!priceKey) return
    let alive = true
    const t = setTimeout(async () => {
      const [date, idStr] = priceKey.split('|')
      const res = await fetchPricesAt(idStr.split(','), date, invoiceId)
      if (!alive) return
      if (res.error) { setErr(`Previous prices: ${res.error}`); return }
      setPrev(res.data ?? {})
    }, 300)
    return () => { alive = false; clearTimeout(t) }
  }, [priceKey, invoiceId])

  const setH = (patch: Partial<InvoiceHeader>) => { dirty.current = true; setHeader((h) => ({ ...h, ...patch })) }
  const setL = (k: string, patch: Partial<DraftLine>) => {
    dirty.current = true
    setLines((ls) => ls.map((l) => (l.k === k ? { ...l, ...patch } : l)))
    if (lineErr[k]) setLineErr((e) => { const n = { ...e }; delete n[k]; return n })
  }
  const addLine = () => { const l = blankLine(); setLines((ls) => [...ls, l]); setFocusKey(l.k) }
  const removeLine = (k: string) => { dirty.current = true; setLines((ls) => (ls.length > 1 ? ls.filter((l) => l.k !== k) : [blankLine()])) }

  const pickItem = (k: string, it: CostItemOption | undefined, id: string | null) => {
    if (!id || !it) { setL(k, { cost_item_id: id }); return }
    setL(k, {
      cost_item_id: id,
      pack_label: it.default_pack_label ?? '',
      base_qty_per_pack: it.default_base_qty_per_pack,
      vat_rate: it.default_vat_rate,
    })
  }

  const createItem = async (k: string, name: string) => {
    const input = {
      name, kind: 'food' as const, category: null, base_unit: 'g' as const, grams_per_unit: null,
      default_pack_label: 'κιλό', default_base_qty_per_pack: 1000, default_vat_rate: 0.13,
      standard_cost_per_unit: null, active: true, notes: null,
    }
    const res = await saveCostItem(input)
    if (res.error || !res.data) { setErr(`Create item «${name}»: ${res.error}`); return }
    const opt: CostItemOption = {
      id: res.data.id, name, kind: 'food', base_unit: 'g', active: true,
      default_pack_label: 'κιλό', default_base_qty_per_pack: 1000, default_vat_rate: 0.13,
    }
    onItemCreated(opt)
    pickItem(k, opt, opt.id)
  }

  const createSupplier = async (name: string) => {
    const res = await saveSupplier({ name, vat_number: null, notes: null, active: true })
    if (res.error || !res.data) { setErr(`Create supplier «${name}»: ${res.error}`); return }
    onSupplierCreated()
    setH({ supplier_id: res.data.id })
  }

  const onFile = async (f: File | undefined) => {
    if (!f) return
    setUploading(true)
    const res = await uploadInvoiceAttachment(f)
    setUploading(false)
    if (fileRef.current) fileRef.current.value = ''
    if (res.error || !res.data) { setErr(`Upload: ${res.error}`); return }
    setH({ attachment_path: res.data })
  }

  const lastFieldEnter = (e: KeyboardEvent, idx: number) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    if (idx === lines.length - 1) addLine()
  }

  const totals = useMemo(() => lines.reduce((a, l) => {
    const m = lineMoney(l); return { net: a.net + m.net, vat: a.vat + m.vat }
  }, { net: 0, vat: 0 }), [lines])

  const close = () => {
    if (saving) return
    if (dirty.current && !confirm('Discard unsaved changes to this invoice?')) return
    onClose()
  }

  const save = async () => {
    setErr(null)
    const he = !header.invoice_date ? 'Invoice date is required.' : null
    setHeadErr(he)
    const used = lines.filter((l) => !isBlank(l))
    const le: Record<string, string> = {}
    for (const l of used) {
      const p: string[] = []
      if (!l.cost_item_id) p.push('item')
      if (l.qty_packs === null || !(l.qty_packs > 0)) p.push('qty > 0')
      if (l.base_qty_per_pack === null || !(l.base_qty_per_pack > 0)) p.push('pack size > 0')
      if (l.net_price_per_pack === null || l.net_price_per_pack < 0) p.push('price ≥ 0')
      if (l.vat_rate !== null && (l.vat_rate < 0 || l.vat_rate > 1)) p.push('VAT 0–100%')
      if (p.length) le[l.k] = `Needs ${p.join(', ')}`
    }
    setLineErr(le)
    if (he || Object.keys(le).length) return
    if (!used.length && !confirm('This invoice has no lines. Save the header only?')) return
    const payload: InvoiceLine[] = used.map((l) => ({
      ...(l.id ? { id: l.id } : {}),
      cost_item_id: l.cost_item_id as string,
      qty_packs: l.qty_packs as number,
      pack_label: l.pack_label.trim() || null,
      base_qty_per_pack: l.base_qty_per_pack as number,
      net_price_per_pack: l.net_price_per_pack as number,
      vat_rate: l.vat_rate ?? 0,
      exclude_from_costing: l.exclude_from_costing,
      note: l.note,
    }))
    setSaving(true)
    const res = await saveInvoice({
      ...header,
      invoice_number: header.invoice_number?.trim() || null,
      notes: header.notes?.trim() || null,
    }, payload)
    setSaving(false)
    if (res.error) { setErr(res.error); return }
    onSaved(`Invoice ${header.invoice_number?.trim() || ''} (${fmtDate(header.invoice_date)}) saved — ${payload.length} lines. Costs rebuilt from ${fmtDate(header.invoice_date)}.`)
  }

  const remove = async () => {
    if (!header.id) return
    if (!confirm('Delete this invoice and all its lines? Item costs will be rebuilt without it.')) return
    setSaving(true)
    const res = await deleteInvoice(header.id)
    setSaving(false)
    if (res.error) { setErr(res.error); return }
    onSaved('Invoice deleted. Costs rebuilt.')
  }

  return (
    <div className="admin-drawer-overlay" onClick={close}>
      <div className="admin-drawer" onClick={(e) => e.stopPropagation()}>
        <header className="admin-drawer-head">
          <div className="admin-drawer-head-title">
            <h2>{invoiceId ? 'Edit invoice' : 'New invoice'}</h2>
            {invoiceId && <span className="cst-note">Editing a past invoice rebuilds costs from its date.</span>}
          </div>
          <button className="admin-drawer-close" onClick={close}>×</button>
        </header>
        <div className="admin-drawer-body" style={{ padding: '12px 16px' }}>
          {err && <div className="admin-error-banner" style={{ marginBottom: 10 }}>{err}</div>}
          {loading ? <div className="admin-loading">Loading…</div> : (
            <>
              <div className="cst-grid-form" style={{ gridTemplateColumns: 'minmax(220px, 2fr) 150px 160px minmax(200px, 2fr)' }}>
                <label>Supplier
                  <SearchPick options={supplierOptions} value={header.supplier_id} placeholder="Search or create supplier…"
                    onChange={(id) => setH({ supplier_id: id })} onCreate={(t) => void createSupplier(t)} />
                </label>
                <label>Invoice date *
                  <input type="date" className="admin-input cst-input" value={header.invoice_date}
                    onChange={(e) => { setH({ invoice_date: e.target.value }); setHeadErr(null) }} />
                  {headErr && <span className="cst-inline-err">{headErr}</span>}
                </label>
                <label>Invoice number
                  <input className="admin-input cst-input" value={header.invoice_number ?? ''}
                    onChange={(e) => setH({ invoice_number: e.target.value })} />
                </label>
                <label>Attachment (photo / PDF)
                  <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input ref={fileRef} type="file" accept="image/*,application/pdf" style={{ display: 'none' }}
                      onChange={(e) => void onFile(e.target.files?.[0])} />
                    <button type="button" className="admin-btn admin-btn-secondary admin-btn-sm" disabled={uploading}
                      onClick={() => fileRef.current?.click()}>
                      {uploading ? 'Uploading…' : header.attachment_path ? 'Replace' : 'Upload'}
                    </button>
                    {header.attachment_path && (
                      <>
                        <a href="#" onClick={(e) => { e.preventDefault(); void openAttachment(header.attachment_path as string, setErr) }}>View</a>
                        <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm" title="Remove attachment from invoice"
                          onClick={() => setH({ attachment_path: null })}>×</button>
                      </>
                    )}
                  </span>
                </label>
              </div>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12, color: '#4b5563', marginTop: 8 }}>Notes
                <input className="admin-input cst-input" value={header.notes ?? ''} onChange={(e) => setH({ notes: e.target.value })} />
              </label>

              <div className="cst-section">
                <h4>Lines <span className="cst-note" style={{ fontWeight: 400 }}>— Enter in the VAT field adds a new line</span></h4>
                <table className="cst-table">
                  <thead>
                    <tr>
                      <th style={{ width: 24 }}>#</th>
                      <th>Cost item</th>
                      <th className="num">Qty</th>
                      <th>Pack</th>
                      <th className="num">Pack size</th>
                      <th className="num">Net €/pack</th>
                      <th className="num">VAT %</th>
                      <th className="num">Line net</th>
                      <th className="num">Unit cost</th>
                      <th className="num" title="Change vs the item's previous price on this date">Δ prev</th>
                      <th title="Exclude from costing (e.g. one-off, wrong price)">Excl.</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l, idx) => (
                      <LineRow key={l.k} l={l} idx={idx} item={l.cost_item_id ? itemById.get(l.cost_item_id) : undefined}
                        prev={l.cost_item_id ? prev[l.cost_item_id] : undefined}
                        itemOptions={itemOptions} autoFocus={l.k === focusKey} error={lineErr[l.k]}
                        onPick={(id, opt) => pickItem(l.k, opt ? itemById.get(opt.id) : undefined, id)}
                        onCreate={(t) => void createItem(l.k, t)}
                        onChange={(p) => setL(l.k, p)} onRemove={() => removeLine(l.k)}
                        onLastEnter={(e) => lastFieldEnter(e, idx)} />
                    ))}
                  </tbody>
                </table>
                <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm" style={{ marginTop: 6 }} onClick={addLine}>+ Add line</button>
              </div>

              <div className="cst-foot-totals">
                <span>Net <b>{fmtEur(totals.net)}</b></span>
                <span>VAT <b>{fmtEur(totals.vat)}</b></span>
                <span>Gross <b style={{ fontSize: 15 }}>{fmtEur(totals.net + totals.vat)}</b></span>
              </div>
              <div className="cst-note" style={{ textAlign: 'right' }}>Check these against the paper invoice before saving.</div>
            </>
          )}
        </div>
        <footer className="admin-drawer-foot">
          {header.id && (
            <button className="admin-btn admin-btn-danger admin-btn-sm" onClick={() => void remove()} disabled={saving}>Delete invoice</button>
          )}
          <div style={{ flex: 1 }} />
          <button className="admin-btn admin-btn-ghost admin-btn-sm" onClick={close} disabled={saving}>Cancel</button>
          <button className="admin-btn admin-btn-primary admin-btn-sm" onClick={() => void save()} disabled={saving || loading || uploading}>
            {saving ? 'Saving…' : 'Save invoice'}
          </button>
        </footer>
      </div>
    </div>
  )
}

// ── one line ─────────────────────────────────────────────────────────────────
function LineRow({ l, idx, item, prev, itemOptions, autoFocus, error, onPick, onCreate, onChange, onRemove, onLastEnter }: {
  l: DraftLine; idx: number; item: CostItemOption | undefined; prev: PrevPrice | undefined
  itemOptions: PickOption[]; autoFocus: boolean; error: string | undefined
  onPick: (id: string | null, opt?: PickOption) => void; onCreate: (text: string) => void
  onChange: (p: Partial<DraftLine>) => void; onRemove: () => void; onLastEnter: (e: KeyboardEvent) => void
}) {
  const unit = item?.base_unit ?? 'g'
  const { net } = lineMoney(l)
  const unitCost = l.net_price_per_pack !== null && l.base_qty_per_pack ? l.net_price_per_pack / l.base_qty_per_pack : null

  let delta: ReactNode = <span className="cst-muted">—</span>
  if (unitCost !== null && prev) {
    if (prev.source === 'unpriced' || !(prev.unit_cost > 0)) {
      delta = <span className="cst-badge cst-est" title="No previous price for this item">new</span>
    } else {
      const d = unitCost / prev.unit_cost - 1
      const big = Math.abs(d) > 0.15
      const txt = `${d >= 0 ? '+' : '−'}${Math.abs(d * 100).toFixed(1)}%`
      delta = (
        <span title={`Previous: ${fmtUnitCost(prev.unit_cost, unit)}${prev.source === 'purchase' ? ` (purchase ${fmtDate(prev.price_date)})` : ' (estimated standard cost)'}`}>
          <span className={big ? `${d > 0 ? 'cst-pos' : 'cst-neg'} cst-strong` : undefined}>{txt}</span>
          {prev.source === 'standard' && <span className="cst-muted" style={{ fontSize: 11 }}> vs est.</span>}
        </span>
      )
    }
  }

  return (
    <>
      <tr style={l.exclude_from_costing ? { opacity: 0.6 } : undefined}>
        <td className="cst-muted">{idx + 1}</td>
        <td style={{ minWidth: 220 }}>
          <SearchPick options={itemOptions} value={l.cost_item_id} onChange={onPick} onCreate={onCreate}
            autoFocus={autoFocus} placeholder="Search item…" />
        </td>
        <td className="num"><NumText value={l.qty_packs} onChange={(v) => onChange({ qty_packs: v })} width={56} /></td>
        <td>
          <input className="admin-input cst-input" style={{ width: 80 }} value={l.pack_label} placeholder="κιλό"
            onChange={(e) => onChange({ pack_label: e.target.value })} />
        </td>
        <td className="num" style={{ whiteSpace: 'nowrap' }}>
          <NumText value={l.base_qty_per_pack} onChange={(v) => onChange({ base_qty_per_pack: v })} width={62} />
          <span className="cst-muted" style={{ fontSize: 11, marginLeft: 3 }}>{UNIT_LABEL[unit] ?? unit}</span>
        </td>
        <td className="num"><NumText value={l.net_price_per_pack} onChange={(v) => onChange({ net_price_per_pack: v })} width={72} /></td>
        <td className="num">
          <span onKeyDown={onLastEnter}>
            <NumText value={l.vat_rate === null ? null : round(l.vat_rate * 100)} width={46}
              onChange={(v) => onChange({ vat_rate: v === null ? null : v / 100 })} />
          </span>
        </td>
        <td className="num">{l.qty_packs !== null && l.net_price_per_pack !== null ? fmtEur(net) : <span className="cst-muted">—</span>}</td>
        <td className="num" style={{ whiteSpace: 'nowrap' }}>{unitCost !== null ? fmtUnitCost(unitCost, unit) : <span className="cst-muted">—</span>}</td>
        <td className="num" style={{ whiteSpace: 'nowrap' }}>{delta}</td>
        <td style={{ textAlign: 'center' }}>
          <input type="checkbox" checked={l.exclude_from_costing} title="Exclude from costing"
            onChange={(e) => onChange({ exclude_from_costing: e.target.checked })} onKeyDown={onLastEnter} />
        </td>
        <td>
          <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm" title="Remove line" tabIndex={-1}
            onClick={onRemove} style={{ color: '#b91c1c', padding: '0 6px' }}>×</button>
        </td>
      </tr>
      {error && <tr><td /><td colSpan={11} className="cst-inline-err">{error}</td></tr>}
    </>
  )
}
