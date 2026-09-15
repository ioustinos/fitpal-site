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

/** The right-hand number columns for one variant, per the ticked opts.
 *  Fixed widths + right alignment so the prices line up in a column down the
 *  page — on a printed sheet that is the single biggest readability win. */
function metaHtml(v: MenuExportVariant | undefined, opts: PdfExportOpts): string {
  if (!v) return ''
  let out = ''
  if (opts.prices) out += `<span class="price">${esc(fmtEur(v.priceCents))}</span>`
  if (opts.macros) out += `<span class="macros">${esc(fmtMacros(v))}</span>`
  return out
}

function dishHtml(d: MenuExportDish, opts: PdfExportOpts): string {
  const rows = d.variantRows ?? []
  const fallback = rows.find((v) => v.isDefault) ?? rows[0]

  // Variants OFF → the dish line carries the DEFAULT variant's price/macros,
  // so ticking «Prices» never produces a sheet with no prices on it.
  if (!opts.variants) {
    return `<div class="dish"><div class="row"><span class="label name">${esc(d.nameEl)}</span>${metaHtml(fallback, opts)}</div></div>`
  }

  const varLines = rows
    .filter((v) => v.label)
    .map((v) => `<div class="row var"><span class="label">${esc(v.label)}</span>${metaHtml(v, opts)}</div>`)
    .join('')

  // A dish with no usable variant labels still needs its price/macros shown.
  const inlineMeta = varLines ? '' : metaHtml(fallback, opts)
  return `<div class="dish"><div class="row"><span class="label name">${esc(d.nameEl)}</span>${inlineMeta}</div>${varLines}</div>`
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
  // WEC-768: the number columns only reserve space when they are actually
  // printed — otherwise a names-only sheet would carry a wide empty gutter.
  const colClass = `${opts.prices ? ' show-price' : ''}${opts.macros ? ' show-macros' : ''}`

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(data.title)}</title>
    <style>
      /* WEC-768: A4, ONE column. The old layout was a 2-up grid of days, which
         on A4 squeezed every day into a narrow box and wrapped long dish names
         to pieces. Days stack; inside a day, categories stack. Never side by side. */
      @page { size: A4; margin: 14mm 13mm 14mm 22mm; }
      * { box-sizing: border-box; }
      body {
        font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        color: #111; margin: 0; font-size: 13px; line-height: 1.6;
        -webkit-print-color-adjust: exact; print-color-adjust: exact;
      }

      /* ── Masthead ─────────────────────────────────────────────── */
      header { border-bottom: 3px solid #00b96b; padding-bottom: 8px; margin-bottom: 18px; }
      h1 { font-size: 23px; line-height: 1.2; margin: 0 0 3px; letter-spacing: -0.2px; }
      .sub { color: #6b7280; font-size: 13px; }

      /* ── Day ──────────────────────────────────────────────────── */
      .day { margin-bottom: 24px; }
      /* A day heading stranded at the foot of a page with its first category
         overleaf is worse than a slightly short page. */
      .day h2 {
        font-size: 15px; margin: 0 0 10px; padding: 5px 9px;
        background: #f0fdf7; border-left: 3px solid #00b96b; border-radius: 3px;
        break-after: avoid; page-break-after: avoid;
      }

      /* ── Category ─────────────────────────────────────────────── */
      .cat { margin: 0 0 16px; break-inside: avoid; page-break-inside: avoid; }
      .cat:last-child { margin-bottom: 0; }
      .cat-name {
        font-size: 13px; text-transform: uppercase; letter-spacing: 0.7px;
        color: #00875a; font-weight: 700; margin: 0 0 7px;
        padding-bottom: 4px; border-bottom: 1px solid #e5e7eb;
      }

      /* ── Dish + variants ──────────────────────────────────────── */
      .dish { margin: 0 0 10px; break-inside: avoid; page-break-inside: avoid; }
      .dish:last-child { margin-bottom: 0; }

      /* One row = label on the left, fixed number columns on the right, so the
         prices and macros align vertically all the way down the page. */
      .row { display: flex; align-items: baseline; gap: 10px; }
      .label { flex: 1 1 auto; min-width: 0; }
      /* WEC-768: dish titles are NOT bold. Hierarchy is carried by size and
         by the indent of the variants under them, which is quieter to read
         down a long sheet than a column of bold. */
      .name { font-weight: 400; font-size: 14px; }
      .var { margin: 3px 0 0 18px; color: #374151; font-size: 12.5px; }

      .price, .macros { flex: 0 0 auto; text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
      .price { font-weight: 700; color: #00875a; font-size: 13px; }
      .macros { color: #6b7280; font-size: 12px; }
      .show-price .price { width: 62px; }
      .show-macros .macros { width: 185px; }

      .empty { color: #9ca3af; font-size: 12.5px; }
    </style></head>
    <body class="${colClass.trim()}">
      <header>
        <h1>${esc(data.title)}</h1>
        <div class="sub">${esc(data.weekFrom)} — ${esc(data.weekTo)}</div>
      </header>
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
