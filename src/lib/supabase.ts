import { createClient } from '@supabase/supabase-js'
import { IS_CLIENT_TAB, CLIENT_TAB_AUTH_KEY } from './clientTab'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables')
}

/**
 * WEC-272 diagnosis: pin the auth flow type to 'implicit'.
 *
 * In supabase-js >= 2.43 the default `flowType` is 'pkce'. PKCE expects
 * `verifyOtp({ token_hash })` (the long URL hash from `{{ .ConfirmationURL }}`)
 * — NOT the 6-digit `{{ .Token }}` code we ask the customer to type. Mixing
 * the two surfaces as `otp_expired` even when the token is alive in the DB.
 *
 * Implicit flow has the verifier skip the PKCE exchange and accept the
 * 6-digit code directly. We never deliver the email-link variant (the
 * code-only template enforces that), so PKCE's prefetch-resistance gives
 * us nothing here.
 */
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    flowType: 'implicit',
    // WEC-868: a client-mode tab keeps the CUSTOMER's session to itself —
    // sessionStorage under its own key, so it never replaces (or signs out)
    // the operator's session in their other tabs, and their tabs never
    // broadcast auth changes into it.
    ...(IS_CLIENT_TAB
      ? { storage: window.sessionStorage, storageKey: CLIENT_TAB_AUTH_KEY, detectSessionInUrl: false }
      : {}),
  },
})
