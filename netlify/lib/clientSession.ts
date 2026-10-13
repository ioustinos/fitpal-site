// WEC-868 — client mode in its own tab (one identity per tab for admins and
// dietitians). Server-side record of every "act as client" session.
//
// Rules enforced here (service role only — the table has no RLS policies):
//   • one OPEN session per operator: opening a new client tab ends the old one
//     with end_reason 'replaced'; the old tab locks on its next heartbeat;
//   • hard expiry 2h after start;
//   • a session counts as alive only while its tab heartbeats (every ~60s);
//     after STALE_MS of silence it is treated as gone ('tab_gone').
import type { SupabaseClient } from '@supabase/supabase-js'

export const SESSION_TTL_MS = 2 * 60 * 60 * 1000
export const STALE_MS = 5 * 60 * 1000

export interface ClientSessionRow {
  id: string
  operator_user_id: string
  operator_role: 'admin' | 'partner'
  client_user_id: string
  partner_id: string | null
  started_at: string
  expires_at: string
  last_seen_at: string
  ended_at: string | null
  end_reason: string | null
}

export type SessionState =
  | { ok: true; row: ClientSessionRow }
  | { ok: false; reason: 'missing' | 'ended' | 'replaced' | 'expired' | 'stale' | 'wrong_client'; row?: ClientSessionRow }

/** Read a session and decide whether it may still act. Ends it in the DB when
 *  it has run out (expired / gone silent) so the admin side sees the truth. */
export async function checkClientSession(
  svc: SupabaseClient, sessionId: string | null | undefined, clientUserId?: string | null,
): Promise<SessionState> {
  if (!sessionId || !/^[0-9a-f-]{36}$/i.test(sessionId)) return { ok: false, reason: 'missing' }
  const { data } = await svc.from('impersonation_sessions').select('*').eq('id', sessionId).maybeSingle()
  const row = data as ClientSessionRow | null
  if (!row) return { ok: false, reason: 'missing' }
  if (row.ended_at) return { ok: false, reason: row.end_reason === 'replaced' ? 'replaced' : row.end_reason === 'expired' ? 'expired' : 'ended', row }
  if (clientUserId && row.client_user_id !== clientUserId) return { ok: false, reason: 'wrong_client', row }
  const now = Date.now()
  if (new Date(row.expires_at).getTime() <= now) {
    await endClientSession(svc, row.id, 'expired')
    return { ok: false, reason: 'expired', row }
  }
  if (now - new Date(row.last_seen_at).getTime() > STALE_MS) {
    await endClientSession(svc, row.id, 'tab_gone')
    return { ok: false, reason: 'stale', row }
  }
  return { ok: true, row }
}

export async function endClientSession(svc: SupabaseClient, sessionId: string, reason: string) {
  await svc.from('impersonation_sessions')
    .update({ ended_at: new Date().toISOString(), end_reason: reason })
    .eq('id', sessionId).is('ended_at', null)
}

/** Open a new session for the operator, ending any session they still have open. */
export async function openClientSession(svc: SupabaseClient, args: {
  operatorUserId: string; operatorRole: 'admin' | 'partner'; clientUserId: string; partnerId: string | null
}): Promise<ClientSessionRow> {
  await svc.from('impersonation_sessions')
    .update({ ended_at: new Date().toISOString(), end_reason: 'replaced' })
    .eq('operator_user_id', args.operatorUserId).is('ended_at', null)
  const { data, error } = await svc.from('impersonation_sessions').insert({
    operator_user_id: args.operatorUserId,
    operator_role: args.operatorRole,
    client_user_id: args.clientUserId,
    partner_id: args.partnerId,
    expires_at: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
  }).select('*').single()
  if (error || !data) throw new Error(error?.message ?? 'could not open client session')
  return data as ClientSessionRow
}

/** Bilingual explanation for a session that can no longer act. */
export function sessionReasonText(reason: string): string {
  switch (reason) {
    case 'replaced': return 'Άνοιξε νέα καρτέλα πελάτη από τον ίδιο χειριστή, οπότε αυτή έκλεισε. · A newer client tab was opened by the same operator, so this one was closed.'
    case 'expired': return 'Η λειτουργία πελάτη έληξε (2 ώρες). · Client mode expired (2 hours).'
    case 'stale': return 'Η καρτέλα πελάτη δεν ήταν ενεργή για αρκετή ώρα. · The client tab was inactive for too long.'
    case 'wrong_client': return 'Η καρτέλα πελάτη αφορά άλλον πελάτη. · This client tab belongs to a different customer.'
    case 'missing': return 'Η λειτουργία πελάτη δεν βρέθηκε. · Client mode session not found.'
    default: return 'Η λειτουργία πελάτη έκλεισε. · Client mode has ended.'
  }
}
