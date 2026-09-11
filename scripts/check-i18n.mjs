// WEC-728 — guard for the split string modules.
//
// Two failure modes this catches, both silent otherwise:
//   1. the same key defined in two modules — the later spread shadows the
//      earlier one, so a string changes meaning with no diff to explain it;
//   2. a key present in one language and missing in the other — renders the
//      raw key to the customer (tr() falls back to the key itself).
//
// Run: node scripts/check-i18n.mjs
import { readdirSync, readFileSync } from 'node:fs'

const dir = new URL('../src/lib/i18n/', import.meta.url)
const files = readdirSync(dir).filter((f) => f.endsWith('.ts'))
const KEY = /^\s{4}([A-Za-z_][\w]*)\s*:/

let fail = 0
const seen = new Map()
for (const f of files) {
  const src = readFileSync(new URL(f, dir), 'utf8')
  const blocks = { el: [], en: [] }
  let cur = null
  for (const line of src.split('\n')) {
    if (/^\s{2}el:\s*\{/.test(line)) { cur = 'el'; continue }
    if (/^\s{2}en:\s*\{/.test(line)) { cur = 'en'; continue }
    if (/^\s{2}\},/.test(line)) { cur = null; continue }
    const m = cur && KEY.exec(line)
    if (m) blocks[cur].push(m[1])
  }
  const el = new Set(blocks.el), en = new Set(blocks.en)
  for (const k of el) if (!en.has(k)) { console.error(`✗ ${f}: "${k}" has EL but no EN`); fail++ }
  for (const k of en) if (!el.has(k)) { console.error(`✗ ${f}: "${k}" has EN but no EL`); fail++ }
  for (const k of el) {
    if (seen.has(k)) { console.error(`✗ duplicate key "${k}" in ${seen.get(k)} and ${f}`); fail++ }
    else seen.set(k, f)
  }
}
if (fail) { console.error(`\n${fail} problem(s).`); process.exit(1) }
console.log(`✓ i18n ok — ${seen.size} unique keys across ${files.length} modules, EL/EN complete`)
