// WEC-366: dependency-free weekly-menu export.
//   - PDF  → opens a print-friendly window and triggers the browser's print
//            dialog (the user picks "Save as PDF"). Ideal for a kitchen sheet.
//   - Excel → builds an HTML <table> and downloads it as .xls; Excel/Numbers/
//            Sheets open it natively. No runtime deps = no npm install needed.

export interface MenuExportDish {
  nameEl: string
  nameEn: string
  variants: string[]
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

function dayBlocksHtml(data: MenuExportData): string {
  return data.days
    .map((day) => {
      const cats = day.categories.length
        ? day.categories
            .map((c) => {
              const rows = c.dishes
                .map((d) => {
                  const variants = d.variants.filter(Boolean).join(' · ')
                  return `<div class="dish"><span class="dish-name">${esc(d.nameEl)}</span>${
                    variants ? `<span class="dish-variants">${esc(variants)}</span>` : ''
                  }</div>`
                })
                .join('')
              return `<div class="cat"><div class="cat-name">${esc(c.catName)}</div>${rows}</div>`
            })
            .join('')
        : '<div class="empty">—</div>'
      return `<section class="day"><h2>${esc(day.dayName)} · ${esc(day.date)}</h2>${cats}</section>`
    })
    .join('')
}

export function exportMenuToPdf(data: MenuExportData): void {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(data.title)}</title>
    <style>
      * { box-sizing: border-box; }
      body { font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #111; margin: 24px; }
      h1 { font-size: 20px; margin: 0 0 2px; }
      .sub { color: #666; font-size: 12px; margin-bottom: 18px; }
      .days { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; }
      .day { break-inside: avoid; border: 1px solid #ddd; border-radius: 8px; padding: 12px 14px; }
      .day h2 { font-size: 14px; margin: 0 0 8px; border-bottom: 2px solid #00b96b; padding-bottom: 4px; }
      .cat { margin-bottom: 10px; }
      .cat-name { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #00875a; font-weight: 700; margin-bottom: 3px; }
      .dish { font-size: 12px; margin: 2px 0; }
      .dish-name { font-weight: 600; }
      .dish-variants { color: #666; margin-left: 6px; }
      .empty { color: #999; font-size: 12px; }
      @media print { body { margin: 12mm; } .days { gap: 12px; } }
    </style></head>
    <body>
      <h1>${esc(data.title)}</h1>
      <div class="sub">${esc(data.weekFrom)} — ${esc(data.weekTo)}</div>
      <div class="days">${dayBlocksHtml(data)}</div>
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

export function exportMenuToXls(data: MenuExportData): void {
  const rows: string[] = [
    '<tr><th>Day</th><th>Date</th><th>Category</th><th>Dish (EL)</th><th>Dish (EN)</th><th>Variants</th></tr>',
  ]
  for (const day of data.days) {
    if (day.categories.length === 0) {
      rows.push(`<tr><td>${esc(day.dayName)}</td><td>${esc(day.date)}</td><td></td><td>—</td><td></td><td></td></tr>`)
      continue
    }
    for (const c of day.categories) {
      for (const d of c.dishes) {
        rows.push(
          `<tr><td>${esc(day.dayName)}</td><td>${esc(day.date)}</td><td>${esc(c.catName)}</td>` +
            `<td>${esc(d.nameEl)}</td><td>${esc(d.nameEn)}</td><td>${esc(d.variants.filter(Boolean).join(' / '))}</td></tr>`,
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
