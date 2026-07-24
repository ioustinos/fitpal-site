// WEC-557 — «Αίτημα αλλαγής» (order change request) API.
// Customer creates a request against one of their still-actionable orders; it
// lands as a row for ops in the admin panel. RLS enforces own-order ownership.

import { supabase } from '../supabase'

export type OrderChangeReason = 'cancel' | 'address_or_time' | 'dish' | 'other'
export type OrderChangeStatus = 'new' | 'handled'

export interface OrderChangeRequest {
  id: string
  orderId: string
  userId: string | null
  reason: OrderChangeReason
  message: string | null
  status: OrderChangeStatus
  createdAt: string
  handledAt: string | null
  handledBy: string | null
}

function mapRow(r: Record<string, unknown>): OrderChangeRequest {
  return {
    id: r.id as string,
    orderId: r.order_id as string,
    userId: (r.user_id as string) ?? null,
    reason: r.reason as OrderChangeReason,
    message: (r.message as string) ?? null,
    status: r.status as OrderChangeStatus,
    createdAt: r.created_at as string,
    handledAt: (r.handled_at as string) ?? null,
    handledBy: (r.handled_by as string) ?? null,
  }
}

/** Customer: submit a change request for one of their orders. */
export async function createOrderChangeRequest(input: {
  orderId: string
  userId: string
  reason: OrderChangeReason
  message: string
}): Promise<{ error: string | null }> {
  const { error } = await supabase.from('order_change_requests').insert({
    order_id: input.orderId,
    user_id: input.userId,
    reason: input.reason,
    message: input.message.trim() || null,
  })
  return { error: error?.message ?? null }
}

/** Customer: existing requests for a set of orders (to show "request pending"). */
export async function fetchMyChangeRequests(orderIds: string[]): Promise<{
  data: OrderChangeRequest[]
  error: string | null
}> {
  if (orderIds.length === 0) return { data: [], error: null }
  const { data, error } = await supabase
    .from('order_change_requests')
    .select('*')
    .in('order_id', orderIds)
    .order('created_at', { ascending: false })
  if (error) return { data: [], error: error.message }
  return { data: (data ?? []).map((r) => mapRow(r as Record<string, unknown>)), error: null }
}

// ─── Admin (RLS: is_admin) — ready to wire into the Orders drawer ────────────

/** Admin: all change requests for one order (drawer). */
export async function fetchOrderChangeRequests(orderId: string): Promise<{
  data: OrderChangeRequest[]
  error: string | null
}> {
  const { data, error } = await supabase
    .from('order_change_requests')
    .select('*')
    .eq('order_id', orderId)
    .order('created_at', { ascending: false })
  if (error) return { data: [], error: error.message }
  return { data: (data ?? []).map((r) => mapRow(r as Record<string, unknown>)), error: null }
}

/** Admin: count of unhandled ('new') requests — powers the Orders-list badge. */
export async function fetchPendingChangeRequestCount(): Promise<{ count: number; error: string | null }> {
  const { count, error } = await supabase
    .from('order_change_requests')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'new')
  if (error) return { count: 0, error: error.message }
  return { count: count ?? 0, error: null }
}

/** Admin: mark a request handled (writes handled_at + handled_by). */
export async function markChangeRequestHandled(id: string, adminUserId: string): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('order_change_requests')
    .update({ status: 'handled', handled_at: new Date().toISOString(), handled_by: adminUserId })
    .eq('id', id)
  return { error: error?.message ?? null }
}
