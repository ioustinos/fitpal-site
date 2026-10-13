import { supabase } from '../supabase'

/**
 * Admin costing API (epic WEC-857 — cost items, purchases, components, dish
 * product cost). Shared by every /admin/costing/* screen.
 *
 * Reads go through admin-only SECURITY DEFINER RPCs that return ONE jsonb
 * value (supabase/migrations/wec862_costing_api.sql) — no 1000-row cap.
 * Plain CRUD goes straight to the cost_* tables (admin RLS, wec858).
 * Every write fires the costing triggers (wec859): the ledger (cost_history)
 * is rebuilt from the affected date inside the same transaction.
 *
 * Shapes are kept in the DB's snake_case on purpose — they are read models.
 * Money is NUMERIC EUROS (not cents): per-gram costs need sub-cent precision.
 */

type Res<T> = { data: T | null; error: string | null }

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<Res<T>> {
  const { data, error } = await supabase.rpc(fn, args ?? {})
  if (error) return { data: null, error: error.message }
  return { data: data as T, error: null }
}

const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v))

// ── shared types ─────────────────────────────────────────────────────────────
export type CostSource = 'purchase' | 'standard' | 'unpriced'
export type CostFlags = {
  estimated?: boolean
  unpriced?: number | boolean
  unlinked?: number
  no_version?: boolean
  no_weight?: boolean
  zero_output?: boolean
  no_packaging?: boolean
  cycle?: boolean
}
export type BaseUnit = 'g' | 'ml' | 'pcs'
export type ItemKind = 'food' | 'packaging'

// ── summary / nightly check (WEC-861) ────────────────────────────────────────
export interface CostCheckRun {
  id: number
  started_at: string
  finished_at: string | null
  trigger_source: 'manual' | 'scheduled' | 'test'
  days_back: number
  entities_checked: number
  values_checked: number
  mismatch_count: number
  mismatches?: Array<{
    entity_type: string; entity_id: string; date: string
    ledger: number | null; recomputed: number; delta: number | null
  }>
  error: string | null
  status: 'running' | 'ok' | 'mismatch' | 'error'
  duration_ms: number | null
}

export interface CostSummary {
  items: number
  items_unpriced: number
  items_estimated: number
  components: number
  components_fixed: number
  invoices: number
  last_invoice_date: string | null
  variants: number
  variants_unlinked: number
  links_unconfirmed: number
  queue_pending: number
  last_check: CostCheckRun | null
}

export const fetchCostSummary = () => rpc<CostSummary>('admin_cost_summary')
export const runCostCheck = () =>
  rpc<{ run_id: number; status: string; mismatch_count: number; error: string | null; duration_ms: number }>('admin_cost_check_run')

export async function fetchCheckRuns(limit = 20): Promise<Res<CostCheckRun[]>> {
  const { data, error } = await supabase
    .from('cost_check_runs').select('*').order('started_at', { ascending: false }).limit(limit)
  if (error) return { data: null, error: error.message }
  return { data: data as CostCheckRun[], error: null }
}

// ── cost items (WEC-862) ─────────────────────────────────────────────────────
export interface CostItemRow {
  id: string
  name: string
  kind: ItemKind
  category: string | null
  base_unit: BaseUnit
  grams_per_unit: number | null
  default_pack_label: string | null
  default_base_qty_per_pack: number
  default_vat_rate: number
  standard_cost_per_unit: number | null
  active: boolean
  notes: string | null
  source_ref: string | null
  /** € per base unit, net, from the ledger for today */
  unit_cost: number | null
  source: CostSource | null
  price_date: string | null
  /** [date, unit_cost] points of the last 90 days */
  spark: Array<[string, number]> | null
  used_in_components: number
  used_in_dishes: number
  purchases: number
}

export const fetchCostItems = () => rpc<CostItemRow[]>('admin_cost_items_overview')

export interface CostItemDetail {
  current: { unit_cost: number; source: CostSource; price_date?: string; purchase_line_id?: string }
  purchases: Array<{
    line_id: string; invoice_id: string; invoice_date: string; invoice_number: string | null; supplier: string | null
    qty_packs: number; pack_label: string | null; base_qty_per_pack: number; net_price_per_pack: number
    vat_rate: number; unit_cost: number; exclude_from_costing: boolean
  }>
  history: Array<{ date: string; unit_cost: number; flags: CostFlags; cause: string | null }>
  components: Array<{ id: string; name: string }>
  dishes: Array<{ id: string; name: string; qty: number }>
}
export const fetchCostItemDetail = (id: string) => rpc<CostItemDetail>('admin_cost_item_detail', { p_id: id })

export interface CostItemInput {
  id?: string
  name: string
  kind: ItemKind
  category: string | null
  base_unit: BaseUnit
  grams_per_unit: number | null
  default_pack_label: string | null
  default_base_qty_per_pack: number
  default_vat_rate: number
  standard_cost_per_unit: number | null
  active: boolean
  notes: string | null
}

export async function saveCostItem(input: CostItemInput): Promise<Res<{ id: string }>> {
  const { id, ...row } = input
  const q = id
    ? supabase.from('cost_items').update(row).eq('id', id).select('id').single()
    : supabase.from('cost_items').insert(row).select('id').single()
  const { data, error } = await q
  if (error) return { data: null, error: error.message }
  return { data: data as { id: string }, error: null }
}

/** Unit cost of several items on a date, ignoring one invoice (the one being edited). */
export const fetchPricesAt = (ids: string[], date: string, excludeInvoice?: string | null) =>
  rpc<Record<string, { unit_cost: number; source: CostSource; price_date?: string }>>('admin_cost_items_price_at', {
    p_ids: ids, p_date: date, p_exclude_invoice: excludeInvoice ?? null,
  })

/** Light list for pickers: id, name, kind, unit, defaults. */
export interface CostItemOption {
  id: string; name: string; kind: ItemKind; base_unit: BaseUnit; active: boolean
  default_pack_label: string | null; default_base_qty_per_pack: number; default_vat_rate: number
}
export async function fetchCostItemOptions(): Promise<Res<CostItemOption[]>> {
  const out: CostItemOption[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('cost_items')
      .select('id, name, kind, base_unit, active, default_pack_label, default_base_qty_per_pack, default_vat_rate')
      .order('name').range(from, from + 999)
    if (error) return { data: null, error: error.message }
    out.push(...(data as CostItemOption[]).map((r) => ({
      ...r, default_base_qty_per_pack: Number(r.default_base_qty_per_pack), default_vat_rate: Number(r.default_vat_rate),
    })))
    if (!data || data.length < 1000) break
  }
  return { data: out, error: null }
}

// ── suppliers (WEC-862) ──────────────────────────────────────────────────────
export interface SupplierRow {
  id: string; name: string; vat_number: string | null; notes: string | null; active: boolean
  invoices: number; last_invoice_date: string | null; total_net: number
}
export const fetchSuppliers = () => rpc<SupplierRow[]>('admin_cost_suppliers_overview')

export async function saveSupplier(input: { id?: string; name: string; vat_number: string | null; notes: string | null; active: boolean }): Promise<Res<{ id: string }>> {
  const { id, ...row } = input
  const q = id
    ? supabase.from('cost_suppliers').update(row).eq('id', id).select('id').single()
    : supabase.from('cost_suppliers').insert(row).select('id').single()
  const { data, error } = await q
  if (error) return { data: null, error: error.message }
  return { data: data as { id: string }, error: null }
}

// ── purchase invoices (WEC-863) ──────────────────────────────────────────────
export interface InvoiceListRow {
  id: string; invoice_date: string; invoice_number: string | null; supplier_id: string | null; supplier: string | null
  attachment_path: string | null; notes: string | null; lines: number; net: number; vat: number; gross: number
}
export const fetchInvoices = (f: { supplierId?: string | null; from?: string | null; to?: string | null } = {}) =>
  rpc<InvoiceListRow[]>('admin_cost_invoices_list', { p_supplier: f.supplierId ?? null, p_from: f.from ?? null, p_to: f.to ?? null })

export interface InvoiceHeader {
  id?: string
  supplier_id: string | null
  invoice_date: string
  invoice_number: string | null
  attachment_path: string | null
  notes: string | null
}
export interface InvoiceLine {
  id?: string
  cost_item_id: string
  qty_packs: number
  pack_label: string | null
  base_qty_per_pack: number
  net_price_per_pack: number
  vat_rate: number
  exclude_from_costing: boolean
  note: string | null
  sort_order?: number
  /** read-only, generated */
  unit_cost?: number
  line_net?: number
}

export async function fetchInvoice(id: string): Promise<Res<{ header: InvoiceHeader & { id: string }; lines: InvoiceLine[] }>> {
  const [h, l] = await Promise.all([
    supabase.from('cost_purchase_invoices').select('id, supplier_id, invoice_date, invoice_number, attachment_path, notes').eq('id', id).single(),
    supabase.from('cost_purchase_lines').select('*').eq('invoice_id', id).order('sort_order').order('created_at'),
  ])
  if (h.error) return { data: null, error: h.error.message }
  if (l.error) return { data: null, error: l.error.message }
  const lines = (l.data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    cost_item_id: r.cost_item_id as string,
    qty_packs: Number(r.qty_packs),
    pack_label: (r.pack_label as string) ?? null,
    base_qty_per_pack: Number(r.base_qty_per_pack),
    net_price_per_pack: Number(r.net_price_per_pack),
    vat_rate: Number(r.vat_rate),
    exclude_from_costing: !!r.exclude_from_costing,
    note: (r.note as string) ?? null,
    sort_order: Number(r.sort_order),
    unit_cost: num(r.unit_cost) ?? undefined,
    line_net: num(r.line_net) ?? undefined,
  }))
  return { data: { header: h.data as InvoiceHeader & { id: string }, lines }, error: null }
}

/**
 * Save header + lines. Lines missing from `lines` but present before are
 * removed. Not one transaction (PostgREST), but each step is safe on its own:
 * the ledger rebuilds after every statement.
 */
export async function saveInvoice(header: InvoiceHeader, lines: InvoiceLine[]): Promise<Res<{ id: string }>> {
  const { id, ...h } = header
  let invoiceId = id
  if (invoiceId) {
    const { error } = await supabase.from('cost_purchase_invoices').update(h).eq('id', invoiceId)
    if (error) return { data: null, error: error.message }
  } else {
    const { data, error } = await supabase.from('cost_purchase_invoices').insert(h).select('id').single()
    if (error) return { data: null, error: error.message }
    invoiceId = (data as { id: string }).id
  }
  const keep = lines.filter((l) => l.id).map((l) => l.id as string)
  const { data: existing, error: exErr } = await supabase.from('cost_purchase_lines').select('id').eq('invoice_id', invoiceId)
  if (exErr) return { data: null, error: exErr.message }
  const remove = (existing ?? []).map((r: { id: string }) => r.id).filter((x) => !keep.includes(x))
  if (remove.length) {
    const { error } = await supabase.from('cost_purchase_lines').delete().in('id', remove)
    if (error) return { data: null, error: error.message }
  }
  for (let i = 0; i < lines.length; i++) {
    const { id: lineId, unit_cost: _u, line_net: _n, ...row } = lines[i]
    void _u; void _n
    const payload = { ...row, invoice_id: invoiceId, sort_order: i }
    const { error } = lineId
      ? await supabase.from('cost_purchase_lines').update(payload).eq('id', lineId)
      : await supabase.from('cost_purchase_lines').insert(payload)
    if (error) return { data: null, error: `Γραμμή ${i + 1}: ${error.message}` }
  }
  return { data: { id: invoiceId as string }, error: null }
}

export async function deleteInvoice(id: string): Promise<Res<true>> {
  const { error } = await supabase.from('cost_purchase_invoices').delete().eq('id', id)
  if (error) return { data: null, error: error.message }
  return { data: true, error: null }
}

/** Upload a photo / PDF to the private bucket; returns the storage path. */
export async function uploadInvoiceAttachment(file: File): Promise<Res<string>> {
  const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '')
  const path = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage.from('cost-invoices').upload(path, file, { contentType: file.type || undefined })
  if (error) return { data: null, error: error.message }
  return { data: path, error: null }
}

export async function attachmentUrl(path: string): Promise<Res<string>> {
  const { data, error } = await supabase.storage.from('cost-invoices').createSignedUrl(path, 600)
  if (error) return { data: null, error: error.message }
  return { data: data.signedUrl, error: null }
}

// ── components (WEC-864) ─────────────────────────────────────────────────────
export type YieldMode = 'pct' | 'output_weight' | 'fixed'
export interface ComponentRow {
  id: string; name: string; category: string | null; active: boolean; source_ref: string | null
  cost_per_g: number | null; cost_per_g_30d: number | null; flags: CostFlags | null
  yield_mode: YieldMode | null; yield_pct: number | null; output_weight_g: number | null; version_no: number | null
  versions: number; drafts: number; used_in_dishes: number; used_in_components: number
}
export const fetchComponents = () => rpc<ComponentRow[]>('admin_cost_components_overview')

export interface ComponentBreakdownLine {
  kind: 'item' | 'component'; id: string; name: string; qty: number; unit: string
  unit_cost: number; source?: CostSource; price_date?: string | null; line_cost: number; flags?: CostFlags
}
export interface ComponentBreakdown {
  cost_per_g: number; total_cost?: number; raw_weight_g?: number; output_g?: number
  version_id?: string; version_no?: number; effective_from?: string
  yield_mode?: YieldMode; yield_pct?: number | null; output_weight_g?: number | null
  flags: CostFlags; lines: ComponentBreakdownLine[]
}
export interface ComponentVersion {
  id: string; version_no: number; effective_from: string; status: 'draft' | 'published'
  yield_mode: YieldMode; yield_pct: number | null; output_weight_g: number | null; fixed_cost_per_g: number | null
  notes: string | null; created_at: string; published_at: string | null; created_by: string | null
  lines: Array<{ id: string; cost_item_id: string | null; child_component_id: string | null; name: string; unit: string; qty: number; note: string | null }>
}
export interface ComponentDetail {
  component: { id: string; name: string; category: string | null; active: boolean; notes: string | null; source_ref: string | null }
  as_of: string
  breakdown: ComponentBreakdown
  versions: ComponentVersion[]
  history: Array<{ date: string; cost_per_g: number; flags: CostFlags; cause: string | null }>
  dishes: Array<{ id: string; name: string; ingredient: string; source: string }>
  parents: Array<{ id: string; name: string }>
}
export const fetchComponentDetail = (id: string, date?: string | null) =>
  rpc<ComponentDetail>('admin_cost_component_detail', { p_id: id, p_date: date ?? null })

export interface ComponentSaveInput {
  component_id?: string | null
  /** set to create a component, or to rename an existing one */
  name?: string
  category?: string | null
  notes?: string | null
  /** save onto this existing draft instead of creating a new version */
  draft_id?: string | null
  effective_from: string
  yield_mode: YieldMode
  yield_pct?: number | null
  output_weight_g?: number | null
  fixed_cost_per_g?: number | null
  publish: boolean
  version_notes?: string | null
  lines: Array<{ cost_item_id?: string | null; child_component_id?: string | null; qty: number; note?: string | null }>
}

export async function saveComponentVersion(input: ComponentSaveInput): Promise<Res<{ component_id: string; version_id: string }>> {
  if (input.draft_id) {
    // drafts are not costed: clear the old lines, the RPC writes the new set
    const { error } = await supabase.from('cost_component_version_lines').delete().eq('version_id', input.draft_id)
    if (error) return { data: null, error: error.message }
  }
  return rpc('admin_cost_component_save', { p: input })
}

export async function setComponentActive(id: string, active: boolean): Promise<Res<true>> {
  const { error } = await supabase.from('cost_components').update({ active }).eq('id', id)
  if (error) return { data: null, error: error.message }
  return { data: true, error: null }
}

export interface ComponentOption { id: string; name: string; category: string | null; active: boolean }
export async function fetchComponentOptions(): Promise<Res<ComponentOption[]>> {
  const out: ComponentOption[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('cost_components').select('id, name, category, active')
      .order('name').range(from, from + 999)
    if (error) return { data: null, error: error.message }
    out.push(...(data as ComponentOption[]))
    if (!data || data.length < 1000) break
  }
  return { data: out, error: null }
}

// ── dishes (WEC-866) ─────────────────────────────────────────────────────────
export interface DishCostVariant {
  id: string; label: string; price: number
  food_cost: number | null; packaging_cost: number | null; product_cost: number | null; flags: CostFlags | null
}
export interface DishCostRow {
  id: string; name: string; category_id: string | null; active: boolean; on_menu: boolean
  packaging_items: number; variants: DishCostVariant[] | null
}
export const fetchDishCosts = (date?: string | null) => rpc<DishCostRow[]>('admin_cost_dishes_overview', { p_date: date ?? null })

export interface VariantBreakdown {
  variant_id: string; dish_id: string; date: string; price: number
  food_cost: number; packaging_cost: number; product_cost: number; flags: CostFlags
  lines: Array<{
    ingredient_id: string; ingredient: string; grams: number; component_id: string | null; component?: string
    link_source?: string; cost_per_g?: number; line_cost: number; unlinked?: boolean; flags?: CostFlags
  }>
  packaging: Array<{ cost_item_id: string; name: string; qty: number; unit_cost: number; source: CostSource; line_cost: number }>
}
export const fetchVariantDetail = (variantId: string, date?: string | null) =>
  rpc<{ breakdown: VariantBreakdown; history: Array<{ date: string; product_cost: number; food_cost: number; packaging_cost: number; flags: CostFlags; cause: string | null }> }>(
    'admin_cost_variant_detail', { p_variant: variantId, p_date: date ?? null })

export interface DishPackagingRow { dish_id: string; cost_item_id: string; qty_per_portion: number }
export async function fetchDishPackaging(dishId: string): Promise<Res<DishPackagingRow[]>> {
  const { data, error } = await supabase.from('cost_dish_packaging').select('dish_id, cost_item_id, qty_per_portion').eq('dish_id', dishId)
  if (error) return { data: null, error: error.message }
  return { data: (data ?? []).map((r) => ({ ...r, qty_per_portion: Number(r.qty_per_portion) })) as DishPackagingRow[], error: null }
}

/**
 * Apply one packaging set to many dishes. replace=true first removes each
 * dish's current packaging (so the set becomes exactly `items`).
 */
export async function applyPackaging(dishIds: string[], items: Array<{ cost_item_id: string; qty: number }>, replace: boolean): Promise<Res<number>> {
  if (!dishIds.length) return { data: 0, error: null }
  if (replace) {
    const { error } = await supabase.from('cost_dish_packaging').delete().in('dish_id', dishIds)
    if (error) return { data: null, error: error.message }
  }
  if (!items.length) return { data: 0, error: null }
  return rpc<number>('admin_cost_dish_packaging_apply', { p_dishes: dishIds, p_items: items })
}

// ── dish-line links (WEC-865) ────────────────────────────────────────────────
export type LinkSource = 'auto_excel' | 'default' | 'manual'
export interface LinkReviewDish {
  dish_id: string; dish: string; category_id: string | null
  variants: Array<{ id: string; label: string }> | null
  lines: Array<{
    ingredient_id: string; ingredient: string
    grams: Array<{ variant_id: string; grams: number }>
    component_id: string | null; component: string | null
    source: LinkSource | null; confirmed: boolean; match_note: string | null
  }>
}
export const fetchLinksReview = () => rpc<LinkReviewDish[]>('admin_cost_links_review')

export async function setLink(dishId: string, ingredientId: string, componentId: string, confirmed = true): Promise<Res<true>> {
  const { error } = await supabase.from('cost_dish_line_links').upsert({
    dish_id: dishId, ingredient_id: ingredientId, component_id: componentId,
    source: 'manual', confirmed, updated_at: new Date().toISOString(),
  }, { onConflict: 'dish_id,ingredient_id' })
  if (error) return { data: null, error: error.message }
  return { data: true, error: null }
}

/** Mark existing links of a dish as reviewed (keeps their component). */
export async function confirmLinks(dishId: string, ingredientIds?: string[]): Promise<Res<true>> {
  let q = supabase.from('cost_dish_line_links').update({ confirmed: true, updated_at: new Date().toISOString() }).eq('dish_id', dishId)
  if (ingredientIds?.length) q = q.in('ingredient_id', ingredientIds)
  const { error } = await q
  if (error) return { data: null, error: error.message }
  return { data: true, error: null }
}

export async function clearLink(dishId: string, ingredientId: string): Promise<Res<true>> {
  const { error } = await supabase.from('cost_dish_line_links').delete().eq('dish_id', dishId).eq('ingredient_id', ingredientId)
  if (error) return { data: null, error: error.message }
  return { data: true, error: null }
}

export interface DefaultLinkRow { ingredient_id: string; component_id: string; ingredient: string; component: string }
export async function fetchDefaultLinks(): Promise<Res<DefaultLinkRow[]>> {
  const { data, error } = await supabase.from('cost_ingredient_default_links')
    .select('ingredient_id, component_id, ingredients(name_el), cost_components(name)').limit(1000)
  if (error) return { data: null, error: error.message }
  type Raw = { ingredient_id: string; component_id: string; ingredients: { name_el: string } | null; cost_components: { name: string } | null }
  return {
    data: ((data ?? []) as unknown as Raw[]).map((r) => ({
      ingredient_id: r.ingredient_id, component_id: r.component_id,
      ingredient: r.ingredients?.name_el ?? '?', component: r.cost_components?.name ?? '?',
    })).sort((a, b) => a.ingredient.localeCompare(b.ingredient, 'el')),
    error: null,
  }
}

export async function setDefaultLink(ingredientId: string, componentId: string | null): Promise<Res<true>> {
  const { error } = componentId
    ? await supabase.from('cost_ingredient_default_links').upsert(
        { ingredient_id: ingredientId, component_id: componentId, updated_at: new Date().toISOString() }, { onConflict: 'ingredient_id' })
    : await supabase.from('cost_ingredient_default_links').delete().eq('ingredient_id', ingredientId)
  if (error) return { data: null, error: error.message }
  return { data: true, error: null }
}

/** «N lines unlinked» badge in the dish editor. */
export const fetchDishUnlinkedCount = (dishId: string) => rpc<number>('admin_cost_dish_unlinked_count', { p_dish: dishId })

// ── dish recipe tree (WEC-866 follow-up: recipe + cost per cost item) ─────────
/** A cost item at the bottom of the tree, scaled to the plated portion. */
export interface RecipeItemNode {
  kind: 'item'; id: string; name: string; unit: string
  /** raw quantity in the item's unit for THIS portion */
  qty: number; unit_cost: number; source: CostSource; price_date: string | null
  /** € for this portion */
  cost: number
}
/** A component used at `grams` (cooked) in this portion, with its recipe below it. */
export interface RecipeComponentNode {
  kind: 'component'; id: string; name: string
  grams: number; cost_per_g: number; cost: number
  yield_mode: YieldMode | null; yield_pct: number | null; output_weight_g: number | null
  raw_weight_g: number | null; output_g: number | null; version_no: number | null; effective_from: string | null
  /** nothing below it: fixed-cost Excel estimate, no version, or zero output */
  leaf: boolean
  flags: CostFlags
  children: RecipeNode[]
}
export type RecipeNode = RecipeItemNode | RecipeComponentNode
export interface VariantTree {
  variant_id: string; date: string
  food_cost: number; packaging_cost: number; product_cost: number
  lines: Array<{
    ingredient_id: string; ingredient: string; grams: number; link_source: string | null
    unlinked: boolean; line_cost: number | null; tree: RecipeComponentNode | null
  }>
  /** whole portion, summed per purchased cost item */
  items: Array<{ id: string; name: string; unit: string; qty: number; cost: number; unit_cost: number; source: CostSource; price_date: string | null }>
  /** components with no recipe below them (e.g. Excel fixed-cost estimates) */
  leaf_components: Array<{ id: string; name: string; grams: number; cost: number; yield_mode: YieldMode | null; flags: CostFlags }>
}
export const fetchVariantTree = (variantId: string, date?: string | null) =>
  rpc<VariantTree>('admin_cost_variant_tree', { p_variant: variantId, p_date: date ?? null })
