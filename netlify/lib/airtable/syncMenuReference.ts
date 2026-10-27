// WEC-882: one-way sync DB -> Airtable Menu Reference.
//
// Approach B (Ioustinos 2026-10-26, "safest"): order-item writes are UNCHANGED
// (order items keep their Menu-Reference lookups). This routine keeps the Menu
// Reference ROWS in step with our DB, on demand. Dry-run by default; nothing is
// written unless apply === true.
//
// Source of truth = public.v_menu_reference_sync (one row per dish_variant):
//   code, dish_id, ingredients, calories, protein, carbs, fat,
//   title, description, category, price_incvat, price_exvat
// Match to Menu Reference on {Κωδικός}. We only UPDATE existing rows — never
// create/delete — and never blank a text cell from an empty DB value.
//
// Fields written (WEC-882, all confirmed against the live base):
//   Κρυμμένο Πεδίο, Θερμίδες, Πρωτεϊνη, Υδατάνθρακες, Λιπαρά,
//   Τίτλος, Περιγραφή, Κατηγορία, Price (ex-VAT), Price (ΦΠΑ)
// The backup column "Κρυμμένο Πεδίο Static from Meals Management (27 oct)" is
// NEVER touched.

import type { SupabaseClient } from '@supabase/supabase-js'
import { TABLES } from './env'
import { listRecords, updateRecords } from './client'

// Menu Reference field IDs (verified against the live base).
const F = {
  code: 'flde9c9t6jwvhHiwG',         // Κωδικός (match key)
  ingredients: 'fldxSMupS89ots80X',  // Κρυμμένο Πεδίο
  cal: 'fldIYSwIupQEFJSoH',          // Θερμίδες
  carb: 'fldBHQo3edqvfLP2q',         // Υδατάνθρακες
  pro: 'fldQ2mp6WaSCjIBSt',          // Πρωτεϊνη
  fat: 'fldLlnvmTTkJVqeRZ',          // Λιπαρά
  title: 'fldwBXPxfdzboOgQy',        // Τίτλος
  desc: 'fldqBCXVzhdhRCEor',         // Περιγραφή
  category: 'fld1IDPD7Lwb2v5Xn',     // Κατηγορία (singleSelect)
  priceExVat: 'fld6D0GqOYphpOqZU',   // Price
  priceIncVat: 'fldo8Yn4Hp0W3wRN5',  // Price (ΦΠΑ)
} as const
// Field NAMES for READING (listRecords returns fields keyed by name).
const N = {
  code: 'Κωδικός',
  ingredients: 'Κρυμμένο Πεδίο',
  cal: 'Θερμίδες', carb: 'Υδατάνθρακες', pro: 'Πρωτεϊνη', fat: 'Λιπαρά',
  title: 'Τίτλος', desc: 'Περιγραφή', category: 'Κατηγορία',
  priceExVat: 'Price', priceIncVat: 'Price (ΦΠΑ)',
} as const

// Κατηγορία (singleSelect, typecast false): the MR choices were aligned to our
// site's category names (WEC-882), so we write name_el straight through. The
// allow-set stays as a defensive guard — if a category ever isn't a known MR
// choice, we skip that one field (never 422) rather than failing the row.
const CATEGORY_CHOICES = new Set([
  'Πρωινά', 'Snacks', 'Σαλάτες', 'Ατομικές Σαλάτες', 'Μαγειρευτά',
  'Ψητές Επιλογές', 'Healthy Bowls', 'Smoothies', 'Νερό / Αναψυκτικά',
])
function mapCategory(name: string | null): string | null {
  const n = (name ?? '').trim()
  return CATEGORY_CHOICES.has(n) ? n : null // null => skip category field
}

interface DbRow {
  code: string | null
  ingredients: string | null
  calories: number | null
  protein: number | null
  carbs: number | null
  fat: number | null
  title: string | null
  description: string | null
  category: string | null
  price_incvat: number | string | null
  price_exvat: number | string | null
}

interface FieldChange { field: string; from: unknown; to: unknown }
export interface SyncChange { code: string; recordId: string; changes: FieldChange[] }
export interface SyncReport {
  mode: 'dry-run' | 'apply'
  dbVariants: number
  mrRows: number
  changed: SyncChange[]
  unchanged: number
  dbNotInMr: string[]
  mrNotInDb: string[]
  blankDbSkipped: string[]   // empty recipe → skipped entirely
  categorySkipped: string[]  // category had no matching MR choice (other fields still synced)
  applied: number
  appliedErrors: string[]
}

function norm(s: unknown): string { return s == null ? '' : String(s).trim() }
function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v); return Number.isFinite(n) ? n : null
}
function round2(n: number | null): number | null { return n == null ? null : Math.round(n * 100) / 100 }

export async function syncMenuReference(
  supabase: SupabaseClient,
  opts: { apply?: boolean; codes?: string[] } = {},
): Promise<SyncReport> {
  const apply = opts.apply === true
  const codes = opts.codes && opts.codes.length > 0 ? opts.codes : null

  let dbQuery = supabase.from('v_menu_reference_sync').select('*')
  if (codes) dbQuery = dbQuery.in('code', codes)
  const { data, error } = await dbQuery
  if (error) throw new Error(`v_menu_reference_sync read failed: ${error.message}`)
  const dbByCode = new Map<string, DbRow>()
  for (const r of (data ?? []) as DbRow[]) { if (r.code) dbByCode.set(r.code, r) }

  const mrFormula = codes
    ? `OR(${codes.map((c) => `{Κωδικός}='${String(c).replace(/'/g, '')}'`).join(',')})`
    : "NOT({Κωδικός}='')"
  const mrRecords = await listRecords(TABLES.menuReference, mrFormula)
  const mrByCode = new Map<string, { id: string; fields: Record<string, unknown> }>()
  for (const r of mrRecords) {
    const fields = r.fields as Record<string, unknown>
    const code = norm(fields[N.code])
    if (code) mrByCode.set(code, { id: r.id, fields })
  }

  const report: SyncReport = {
    mode: apply ? 'apply' : 'dry-run',
    dbVariants: dbByCode.size,
    mrRows: mrByCode.size,
    changed: [], unchanged: 0,
    dbNotInMr: [], mrNotInDb: [], blankDbSkipped: [], categorySkipped: [],
    applied: 0, appliedErrors: [],
  }
  const writesByCode = new Map<string, Record<string, unknown>>()     // non-category fields
  const categoryByCode = new Map<string, string>()                     // category, written in its own pass

  for (const code of mrByCode.keys()) if (!dbByCode.has(code)) report.mrNotInDb.push(code)

  for (const [code, d] of dbByCode) {
    const mr = mrByCode.get(code)
    if (!mr) { report.dbNotInMr.push(code); continue }

    const newIng = norm(d.ingredients)
    if (newIng === '') { report.blankDbSkipped.push(code); continue } // never blank MR from empty recipe

    const changes: FieldChange[] = []
    const fieldsToWrite: Record<string, unknown> = {}

    // --- text fields (never blank MR from empty DB value) ---
    const texts: Array<[string, string, string, string]> = [
      // [label, mrFieldId, mrName, newValue]
      ['Κρυμμένο Πεδίο', F.ingredients, N.ingredients, newIng],
      ['Τίτλος', F.title, N.title, norm(d.title)],
      ['Περιγραφή', F.desc, N.desc, norm(d.description)],
    ]
    for (const [label, fid, name, val] of texts) {
      if (val === '') continue
      if (norm(mr.fields[name]) !== val) { changes.push({ field: label, from: norm(mr.fields[name]), to: val }); fieldsToWrite[fid] = val }
    }

    // --- macros (integers) ---
    const macros: Array<[string, string, string, number | null]> = [
      ['Θερμίδες', F.cal, N.cal, d.calories],
      ['Πρωτεϊνη', F.pro, N.pro, d.protein],
      ['Υδατάνθρακες', F.carb, N.carb, d.carbs],
      ['Λιπαρά', F.fat, N.fat, d.fat],
    ]
    for (const [label, fid, name, val] of macros) {
      const cur = numOrNull(mr.fields[name])
      if (cur !== val) { changes.push({ field: label, from: cur, to: val }); fieldsToWrite[fid] = val }
    }

    // --- prices (compare at 2 decimals to avoid float / precision noise) ---
    const prices: Array<[string, string, string, number | null]> = [
      ['Price', F.priceExVat, N.priceExVat, round2(numOrNull(d.price_exvat))],
      ['Price (ΦΠΑ)', F.priceIncVat, N.priceIncVat, round2(numOrNull(d.price_incvat))],
    ]
    for (const [label, fid, name, val] of prices) {
      const cur = round2(numOrNull(mr.fields[name]))
      if (cur !== val && val !== null) { changes.push({ field: label, from: cur, to: val }); fieldsToWrite[fid] = val }
    }

    // --- category (singleSelect; map + allow-set; skip if no matching choice) ---
    const tgtCat = mapCategory(d.category)
    if (tgtCat === null) {
      if (norm(d.category) !== '') report.categorySkipped.push(code)
    } else {
      const curCat = norm((mr.fields[N.category] as { name?: string } | undefined)?.name)
      if (curCat !== tgtCat) { changes.push({ field: 'Κατηγορία', from: curCat, to: tgtCat }); categoryByCode.set(code, tgtCat) }
    }

    if (changes.length === 0) { report.unchanged++; continue }
    report.changed.push({ code, recordId: mr.id, changes })
    writesByCode.set(code, fieldsToWrite)
  }

  if (apply && report.changed.length > 0) {
    // Pass 1 — all non-category fields (always valid, never 422).
    const mainUpdates = report.changed
      .map((c) => ({ id: c.recordId, fields: writesByCode.get(c.code) ?? {} }))
      .filter((u) => Object.keys(u.fields).length > 0)
    if (mainUpdates.length > 0) {
      try {
        const done = await updateRecords(TABLES.menuReference, mainUpdates)
        report.applied += done.length
      } catch (e) {
        report.appliedErrors.push(`main: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    // Pass 2 — category only (single-select). Isolated so a not-yet-created
    // choice fails just the category write, not the rest of the row.
    const catUpdates = report.changed
      .filter((c) => categoryByCode.has(c.code))
      .map((c) => ({ id: c.recordId, fields: { [F.category]: categoryByCode.get(c.code) as string } }))
    if (catUpdates.length > 0) {
      try {
        await updateRecords(TABLES.menuReference, catUpdates)
      } catch (e) {
        report.appliedErrors.push(`category: ${e instanceof Error ? e.message : String(e)} (check MR Κατηγορία choices)`)
      }
    }
  }
  return report
}
