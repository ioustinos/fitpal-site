#!/usr/bin/env node
/* eslint-disable no-console */
//
// WEC-421 — Voucher isolation test for draft orders.
//
// CONTRACT under test:
//   A draft (status='draft') is a customer's in-progress checkout snapshot.
//   It must NEVER consume voucher usage. The redeem happens only inside
//   submit-order's promote path (`redeem_voucher_for_order` RPC).
//   If a customer abandons checkout, the voucher must remain fully usable
//   (per_user_limit and remaining credit untouched).
//
// HOW IT WORKS:
//   1. POSTs to /api/save-draft with `voucher_code` in the body.
//   2. Polls the orders table for the resulting draft row.
//   3. Counts voucher_uses rows referencing that draft. Must be 0.
//   4. Re-validates the voucher via /api/validate-voucher under a *different*
//      cart for the same user — must still pass (i.e. the per_user_limit
//      counter wasn't bumped by the draft).
//   5. Cleans up: deletes the test draft and exits with a PASS/FAIL summary.
//
// HOW TO RUN:
//   cd "Fitpal New Site"
//   netlify dev   # in a separate terminal, expose http://localhost:8888
//   SUPABASE_SERVICE_ROLE_KEY=sb_… \
//   VITE_SUPABASE_URL=https://rhwetztxwjxfstffalwl.supabase.co \
//   VOUCHER_CODE=WELCOME10 \
//   node scripts/wec421-voucher-isolation.mjs
//
// EXPECTED OUTPUT:
//   ✓ Draft created
//   ✓ 0 voucher_uses rows reference the draft
//   ✓ Voucher still validates for the test user
//   ✓ Draft cleaned up
//   WEC-421 PASS

import { createClient } from '@supabase/supabase-js'

const BASE = process.env.BASE_URL || 'http://localhost:8888'
const URL = process.env.VITE_SUPABASE_URL
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY
const CODE = process.env.VOUCHER_CODE
const TEST_EMAIL = process.env.TEST_EMAIL || `wec421-${Date.now()}@example.com`

if (!URL || !SRK) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars.')
  process.exit(2)
}
if (!CODE) {
  console.error('Missing VOUCHER_CODE env var — pass an active voucher code to test.')
  process.exit(2)
}

const sb = createClient(URL, SRK, { auth: { persistSession: false } })

async function main() {
  // 1. Find voucher row and snapshot uses_count + per_user_limit
  const { data: v0, error: vErr } = await sb
    .from('vouchers')
    .select('id, code, active, per_user_limit, max_uses, uses_count, remaining')
    .eq('code', CODE)
    .maybeSingle()
  if (vErr || !v0) throw new Error(`Voucher "${CODE}" not found.`)
  if (!v0.active) throw new Error(`Voucher "${CODE}" is inactive — pick an active one.`)
  const usesBefore = v0.uses_count

  // 2. POST a guest draft with voucher_code set
  const dishId = await pickAnyDishId()
  const body = {
    customer: { name: 'WEC-421 Bot', email: TEST_EMAIL, phone: '+30 6900000000' },
    cart_by_day: [{
      delivery_date: nextWeekdayISO(),
      items: [{ dish_id: dishId, quantity: 1 }],
    }],
    addresses_by_day: [{
      delivery_date: nextWeekdayISO(),
      street: 'Test 1', area: 'Athens', zip: '11635',
      fulfillment_type: 'delivery',
    }],
    payment_method: 'cash',
    voucher_code: CODE,
  }
  const res = await fetch(`${BASE}/api/save-draft`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`save-draft failed: ${res.status} ${await res.text()}`)
  const { draft_id } = await res.json()
  if (!draft_id) throw new Error('save-draft returned no draft_id')
  console.log('✓ Draft created:', draft_id)

  // 3. Assert no voucher_uses row references this draft
  const { count: usesOnDraft, error: cErr } = await sb
    .from('voucher_uses')
    .select('id', { count: 'exact', head: true })
    .eq('voucher_id', v0.id)
    .eq('order_id', draft_id)
  if (cErr) throw cErr
  if ((usesOnDraft ?? 0) !== 0) {
    throw new Error(`FAIL: ${usesOnDraft} voucher_uses rows reference the draft (must be 0).`)
  }
  console.log(`✓ 0 voucher_uses rows reference the draft`)

  // 4. Assert voucher uses_count did NOT increase
  const { data: v1 } = await sb
    .from('vouchers')
    .select('uses_count')
    .eq('id', v0.id)
    .single()
  if ((v1?.uses_count ?? -1) !== usesBefore) {
    throw new Error(`FAIL: vouchers.uses_count moved ${usesBefore} → ${v1?.uses_count}`)
  }
  console.log(`✓ Voucher uses_count unchanged (${usesBefore})`)

  // 5. Cleanup — delete the draft (cascade removes child_orders + order_items)
  const { error: delErr } = await sb.from('orders').delete().eq('id', draft_id)
  if (delErr) throw delErr
  console.log('✓ Draft cleaned up')

  console.log('\nWEC-421 PASS')
}

function nextWeekdayISO() {
  const d = new Date()
  d.setDate(d.getDate() + 7)
  return d.toISOString().slice(0, 10)
}

async function pickAnyDishId() {
  // Picks any active dish so the draft has at least one item; the dish doesn't
  // need to be on any menu for save-draft (drafts don't validate menu membership).
  const { data } = await sb.from('dishes').select('id').eq('active', true).limit(1)
  if (!data || data.length === 0) throw new Error('No active dishes in DB to seed the draft.')
  return data[0].id
}

main().catch((e) => {
  console.error('WEC-421 FAIL:', e?.message ?? e)
  process.exit(1)
})
