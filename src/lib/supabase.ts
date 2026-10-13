import { createClient } from '@supabase/supabase-js'

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
  },
})
