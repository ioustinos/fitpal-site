// WEC-366: dependency-free weekly-menu export.
//   - PDF  → opens a print-friendly window and triggers the browser's print
//            dialog (the user picks "Save as PDF"). Ideal for a kitchen sheet.
//   - Excel → builds an HTML <table> and downloads it as .xls; Excel/Numbers/
//            Sheets open it natively. No runtime deps = no npm install needed.

/** WEC-768: one variant with its own money + macros, so the PDF can print
 *  them on the variant's own line. Each variant really does have its own
 *  price and its own macros — averaging them onto the dish would be a lie. */
export interface MenuExportVariant {
  label: string
  priceCents: number
  cal: number
  pro: number
  carb: number
  fat: number
  isDefault: boolean
}

export interface MenuExportDish {
  nameEl: string
  nameEn: string
  externalId: string | null
  /** Labels only. UNCHANGED — the Excel export reads this and must not move. */
  variants: string[]
  /** WEC-593: real variant count (NOT variants.length — empty labels are
   *  filtered out of that array). Gates the GonnaOrder «-1» suffix. */
  variantCount: number
  /** WEC-768: full variant rows for the PDF. Optional so any other caller of
   *  this model keeps compiling. */
  variantRows?: MenuExportVariant[]
}

/** WEC-768: what the operator ticked in the pre-print popup.
 *  Dish titles and category headings are deliberately NOT options — Ioustinos
 *  ruled they must always print. */
export interface PdfExportOpts {
  variants?: boolean
  prices?: boolean
  macros?: boolean
}

/** WEC-593: options for the Excel export. */
export interface XlsExportOpts {
  /**
   * GonnaOrder re-import format: a dish with 2+ variants has no plain external
   * ID in GO — the main dish IS `XXX-1`. So append «-1» iff the dish has ≥2
   * variants AND has an external ID. Dishes without an external ID stay blank
   * (never a bare `-1`); 1-variant dishes stay plain `XXX`.
   */
  gonnaOrderIds?: boolean
}
export interface MenuExportCategory {
  catName: string
  dishes: MenuExportDish[]
}
export interface MenuExportDay {
  date: string
  dayName: string
  categories: MenuExportCategory[]
}
export interface MenuExportData {
  title: string
  weekFrom: string
  weekTo: string
  days: MenuExportDay[]
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function fmtEur(cents: number): string {
  return `${(cents / 100).toFixed(2)} €`
}

/** «320 kcal · Π 25γ · Υ 30γ · Λ 10γ» — Greek initials because the people
 *  holding this printout in the kitchen read Greek. */
function fmtMacros(v: MenuExportVariant): string {
  const parts: string[] = []
  if (v.cal) parts.push(`${v.cal} kcal`)
  if (v.pro) parts.push(`Π ${v.pro}γ`)
  if (v.carb) parts.push(`Υ ${v.carb}γ`)
  if (v.fat) parts.push(`Λ ${v.fat}γ`)
  return parts.join(' · ')
}

/** The trailing «— 5.50 € — 320 kcal …» for one variant, per the ticked opts. */
function metaHtml(v: MenuExportVariant | undefined, opts: PdfExportOpts): string {
  if (!v) return ''
  let out = ''
  if (opts.prices) out += `<span class="price">${esc(fmtEur(v.priceCents))}</span>`
  if (opts.macros) {
    const m = fmtMacros(v)
    if (m) out += `<span class="macros">${esc(m)}</span>`
  }
  return out
}

function dishHtml(d: MenuExportDish, opts: PdfExportOpts): string {
  const rows = d.variantRows ?? []
  const fallback = rows.find((v) => v.isDefault) ?? rows[0]

  // Variants OFF → the dish line carries the DEFAULT variant's price/macros,
  // so ticking «Prices» never produces a sheet with no prices on it.
  if (!opts.variants) {
    return `<div class="dish"><span class="dish-name">${esc(d.nameEl)}</span>${metaHtml(fallback, opts)}</div>`
  }

  const varLines = rows
    .filter((v) => v.label)
    .map((v) => `<div class="var"><span class="var-label">${esc(v.label)}</span>${metaHtml(v, opts)}</div>`)
    .join('')

  // A dish with no usable variant labels still needs its price/macros shown.
  const inlineMeta = varLines ? '' : metaHtml(fallback, opts)
  return `<div class="dish"><span class="dish-name">${esc(d.nameEl)}</span>${inlineMeta}${varLines}</div>`
}

function dayBlocksHtml(data: MenuExportData, opts: PdfExportOpts): string {
  return data.days
    .map((day) => {
      const cats = day.categories.length
        ? day.categories
            .map(
              (c) =>
                `<div class="cat"><div class="cat-name">${esc(c.catName)}</div>${c.dishes
                  .map((d) => dishHtml(d, opts))
                  .join('')}</div>`,
            )
            .join('')
        : '<div class="empty">—</div>'
      return `<section class="day"><h2>${esc(day.dayName)} · ${esc(day.date)}</h2>${cats}</section>`
    })
    .join('')
}

export function exportMenuToPdf(data: MenuExportData, opts: PdfExportOpts = { variants: true }): void {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(data.title)}</title>
    <style>
      /* WEC-768: A4, ONE column. The old layout was a 2-up grid of days, which
         on A4 squeezed every day into a narrow box and wrapped long dish names
         to pieces. Days stack; inside a day, categories stack. Never side by side. */
      @page { size: A4; margin: 12mm; }
      * { box-sizing: border-box; }
      body { font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #111; margin: 0; }
      h1 { font-size: 20px; margin: 0 0 2px; }
      .sub { color: #666; font-size: 12px; margin-bottom: 16px; }
      .day { margin-bottom: 14px; }
      .day h2 { font-size: 15px; margin: 0 0 8px; border-bottom: 2px solid #00b96b; padding-bottom: 4px; }
      /* Keep a category whole on one page where it fits — a heading orphaned at
         the foot of a page is how a kitchen misses half a category. */
      .cat { margin: 0 0 10px; break-inside: avoid; page-break-inside: avoid; }
      .cat-name { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #00875a; font-weight: 700; margin-bottom: 4px; }
      .dish { font-size: 12px; margin: 0 0 5px; break-inside: avoid; page-break-inside: avoid; }
      .dish-name { font-weight: 600; }
      .var { font-size: 11px; color: #444; margin: 1px 0 0 14px; }
      .var-label { color: #444; }
      .price { font-weight: 600; color: #00875a; margin-left: 8px; white-space: nowrap; }
      .macros { color: #6b7280; margin-left: 8px; white-space: nowrap; }
      .empty { color: #999; font-size: 12px; }
    </style></head>
    <body>
      <h1>${esc(data.title)}</h1>
      <div class="sub">${esc(data.weekFrom)} — ${esc(data.weekTo)}</div>
      ${dayBlocksHtml(data, opts)}
      <script>window.onload = function () { setTimeout(function () { window.print(); }, 250); };</script>
    </body></html>`
  const win = window.open('', '_blank')
  if (!win) {
    alert('Pop-up blocked — allow pop-ups for this site to export the menu as PDF.')
    return
  }
  win.document.open()
  win.document.write(html)
  win.document.close()
}

/** WEC-593: External-ID cell value for a dish, honouring the GonnaOrder rule. */
function externalIdCell(d: MenuExportDish, gonnaOrderIds: boolean): string {
  if (!d.externalId) return '' // no id → stay blank, never a bare "-1"
  return gonnaOrderIds && d.variantCount >= 2 ? `${d.externalId}-1` : d.externalId
}

export function exportMenuToXls(data: MenuExportData, opts: XlsExportOpts = {}): void {
  const gonna = !!opts.gonnaOrderIds
  const rows: string[] = [
    '<tr><th>Day</th><th>Date</th><th>Category</th><th>External ID</th><th>Dish (EL)</th><th>Dish (EN)</th><th>Variants</th></tr>',
  ]
  for (const day of data.days) {
    if (day.categories.length === 0) {
      rows.push(`<tr><td>${esc(day.dayName)}</td><td>${esc(day.date)}</td><td></td><td></td><td>—</td><td></td><td></td></tr>`)
      continue
    }
    for (const c of day.categories) {
      for (const d of c.dishes) {
        rows.push(
          `<tr><td>${esc(day.dayName)}</td><td>${esc(day.date)}</td><td>${esc(c.catName)}</td>` +
            // WEC-593 fix: force the External ID cell to TEXT so Excel doesn't turn
            // ids like "23-1" into the date "23-Jan". mso-number-format:\@ = text.
            `<td style="mso-number-format:'\\@';">${esc(externalIdCell(d, gonna))}</td>` +
            `<td>${esc(d.nameEl)}</td><td>${esc(d.nameEn)}</td>` +
            `<td>${esc(d.variants.filter(Boolean).join(' / '))}</td></tr>`,
        )
      }
    }
  }
  const html =
    `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" ` +
    `xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"></head><body>` +
    `<table border="1">${rows.join('')}</table></body></html>`
  // Prepend a BOM so Excel reads Greek (UTF-8) correctly.
  const blob = new Blob(['﻿', html], { type: 'application/vnd.ms-excel;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${data.title.replace(/[^\w\-]+/g, '_') || 'menu'}.xls`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
