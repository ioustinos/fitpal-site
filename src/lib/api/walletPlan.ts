// API client for the wallet plan endpoints. Mirrors the pattern in
// src/lib/api/* (fetch helpers + typed responses).

import { supabase } from '../supabase'
import type { WalletCalcInput, WalletCalcResult, PaymentMethod } from '../wallet/types'

export interface WalletPlanQuoteResponse {
  result: WalletCalcResult
  config: {
    paymentMethods: PaymentMethod[]
    voucherEnabled: boolean
    servicesCatalog: Array<{ id: string; nameEl: string; nameEn: string; priceCents: number; defaultOn: boolean }>
    minAmountCents: number
  }
}

export interface WalletPlanPurchaseInput extends WalletCalcInput {
  paymentMethod: PaymentMethod
  voucherCode?: string
}

export type WalletPlanPurchaseResponse =
  | { walletPlanId: string; vivaOrderCode: string; paymentUrl: string; paymentMethod: 'card' | 'link' }
  | { walletPlanId: string; paymentMethod: 'transfer'; bankInstructions: { iban: string; beneficiary: string; reference: string } }

/** POST /api/wallet-plan-quote — public, no auth */
export async function fetchWalletPlanQuote(
  input: WalletCalcInput,
): Promise<{ data?: WalletPlanQuoteResponse; error?: string }> {
  try {
    const res = await fetch('/api/wallet-plan-quote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Request failed' }))
      return { error: err.error ?? `HTTP ${res.status}` }
    }
    return { data: await res.json() }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Network error' }
  }
}

/** POST /api/wallet-plan-purchase — auth required, creates the wallet_plan + Viva order */
export async function purchaseWalletPlan(
  input: WalletPlanPurchaseInput,
): Promise<{ data?: WalletPlanPurchaseResponse; error?: string }> {
  const { data: sessionData } = await supabase.auth.getSession()
  const token = sessionData?.session?.access_token
  if (!token) return { error: 'Not authenticated' }

  try {
    const res = await fetch('/api/wallet-plan-purchase', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(input),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Request failed' }))
      return { error: err.error ?? `HTTP ${res.status}` }
    }
    return { data: await res.json() }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Network error' }
  }
}

/** Send a 6-digit email OTP to the given email. Creates the user if missing. */
export async function sendEmailOtp(
  email: string,
  name: string,
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true,
      data: { name },
    },
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

/** Verify a 6-digit email OTP. Returns active session on success. */
export async function verifyEmailOtp(
  email: string,
  token: string,
): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supabase.auth.verifyOtp({
    email,
    token,
    type: 'email',
  })
  if (error) return { ok: false, error: error.message }
  if (!data.session) return { ok: false, error: 'Verification succeeded but no session returned' }
  return { ok: true }
}

/** After OTP verify + phone capture, write phone to the user's profile. */
export async function savePhoneToProfile(phone: string): Promise<{ ok: boolean; error?: string }> {
  const { data: sessionData } = await supabase.auth.getSession()
  const userId = sessionData?.session?.user?.id
  if (!userId) return { ok: false, error: 'Not authenticated' }

  const { error } = await supabase.from('profiles').update({ phone }).eq('id', userId)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
