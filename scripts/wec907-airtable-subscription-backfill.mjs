#!/usr/bin/env node
// WEC-907 one-off: link HISTORICAL wallet-paid orders to their subscription in
// Airtable (Orders.«Subscription» → Subscriptions). Run AFTER the
// wec907b_backfill_wallet_tx_plan.sql backfill on the same database.
//
// Writes ONLY the «Subscription» field, keyed on «Order Id», 10 records per
// request. It does NOT touch orders.airtable_dirty, so the push queue is not
// flooded (the reason this is a script and not a re-push).
//
//   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… AIRTABLE_PAT=… \
//     node scripts/wec907-airtable-subscription-backfill.mjs            # dry run
//   … node scripts/wec907-airtable-subscription-backfill.mjs --apply    # write
import { createClient } from '@supabase/supabase-js'

const BASE = 'appQkyoF5gnDpSW9C'
const ORDERS = 'tblFP0xONtQSJxPd9'
const SUBS = 'tblYSHKBjG5ynmUHK'
const APPLY = process.argv.includes('--apply')
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, AIRTABLE_PAT } = process.env
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !AIRTABLE_PAT) {
  console.error('Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, AIRTABLE_PAT'); process.exit(1)
}
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const at = async (path, init = {}) => {
  const r = await fetch(`https://api.airtable.com/v0/${BASE}/${path}`, {
    ...init, headers: { Authorization: `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
  return r.json()
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 1. order → plan (first debit)
const { data: tx, error } = await sb.from('wallet_transactions')
  .select('order_id, wallet_plan_id, created_at').eq('type', 'debit')
  .not('order_id', 'is', null).not('wallet_plan_id', 'is', null).order('created_at')
if (error) throw error
const planByOrder = new Map()
for (const t of tx) if (!planByOrder.has(t.order_id)) planByOrder.set(t.order_id, t.wallet_plan_id)
console.log(`orders with a plan: ${planByOrder.size}`)

// 2. plan uuid → Airtable record id (all Subscriptions rows, paged)
const subRec = new Map()
let offset
do {
  const q = new URLSearchParams({ pageSize: '100' }); q.append('fields[]', 'Plan Id'); if (offset) q.set('offset', offset)
  const d = await at(`${SUBS}?${q}`)
  for (const r of d.records) if (r.fields['Plan Id']) subRec.set(r.fields['Plan Id'], r.id)
  offset = d.offset; await sleep(220)
} while (offset)

// 3. build + send
const rows = []; let missingPlan = 0
for (const [orderId, planId] of planByOrder) {
  const rec = subRec.get(planId)
  if (!rec) { missingPlan++; continue }
  rows.push({ fields: { 'Order Id': orderId, Subscription: [rec] } })
}
console.log(`to link: ${rows.length} · plan not in Airtable: ${missingPlan} · mode: ${APPLY ? 'APPLY' : 'dry-run'}`)
if (!APPLY) process.exit(0)
// NOTE performUpsert would CREATE an Orders row for an order that isn't in
// Airtable — so look each batch up first and only PATCH existing rows.
let linked = 0, notInAirtable = 0
for (let i = 0; i < rows.length; i += 10) {
  const batch = rows.slice(i, i + 10)
  const formula = `OR(${batch.map((b) => `{Order Id}='${b.fields['Order Id']}'`).join(',')})`
  const found = await at(`${ORDERS}?${new URLSearchParams({ filterByFormula: formula, 'fields[]': 'Order Id' })}`)
  const recByOrder = new Map(found.records.map((r) => [r.fields['Order Id'], r.id]))
  const patch = batch.filter((b) => recByOrder.has(b.fields['Order Id']))
    .map((b) => ({ id: recByOrder.get(b.fields['Order Id']), fields: { Subscription: b.fields.Subscription } }))
  notInAirtable += batch.length - patch.length
  if (patch.length) { await at(ORDERS, { method: 'PATCH', body: JSON.stringify({ records: patch }) }); linked += patch.length }
  await sleep(250)
}
console.log(`linked ${linked} · order not in Airtable ${notInAirtable}`)
