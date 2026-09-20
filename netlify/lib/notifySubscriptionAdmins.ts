// WEC-664: fan a subscription purchase out to the admin notification list
// (settings.order_confirmation_admin_emails) — the same mechanism order
// confirmations use (notify-order-updated.ts). Firing the Klaviyo event to
// each admin email delivers them a copy via the same flow. Fail-soft: never
// throws into the purchase/verify path.

import type { SupabaseClient } from '@supabase/supabase-js'
import { track, subscribeProfileToMarketing } from './klaviyo'

export interface SubAdminNotifyProps {
  subLang: 'el' | 'en'
  userEmail: string
  firstName: string
  planLengthLabel: string
  mealsPerWeek: number
  goalLabel: string | null
  mealsLabel: string | null
  amountPaid: number
  walletPlanId: string
  /** 'pending' (cash/transfer at purchase) or 'paid' (card/link on verify). */
  paymentStatus?: string
  /** WEC-703: voucher applied to the subscription purchase (null when none). */
  voucherCode?: string | null
  voucherDiscount?: number
  /** WEC-797: so the admin copy shows «Τρόπος πληρωμής» + «Ημερομηνία έναρξης». */
  paymentMethod?: string | null
  planStartDate?: string | null
}

export async function notifySubscriptionAdmins(
  supabase: SupabaseClient,
  p: SubAdminNotifyProps,
): Promise<void> {
  try {
    // WEC-666: subscription purchases have their OWN recipient list so we can
    // add maria@fitpal.gr to package notifications WITHOUT also mailing her
    // every à-la-carte order. Falls back to the shared order list when the
    // dedicated key isn't set, so existing coverage never regresses.
    const { data: subRow } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'subscription_notify_admin_emails')
      .maybeSingle()
    let rawAdmins = subRow?.value
    if (!Array.isArray(rawAdmins) || rawAdmins.length === 0) {
      const { data: adminRow } = await supabase
        .from('settings')
        .select('value')
        .eq('key', 'order_confirmation_admin_emails')
        .maybeSingle()
      rawAdmins = adminRow?.value
    }
    const adminEmails = Array.isArray(rawAdmins)
      ? (rawAdmins as unknown[])
          .filter((v): v is string => typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()))
          .map((v) => v.trim())
      : []
    const custLower = p.userEmail.toLowerCase()
    for (const adminEmail of adminEmails) {
      if (adminEmail.toLowerCase() === custLower) continue
      await subscribeProfileToMarketing(adminEmail, 'Fitpal admin BCC (auto-subscribe)')
      await track(
        'Subscription Purchased',
        { email: adminEmail, firstName: 'Fitpal', lastName: 'Admin notification' },
        {
          lang: p.subLang,
          is_admin_copy: true,
          isAdminCopy: true,
          customer_email: p.userEmail,
          first_name: p.firstName,
          plan_length_label: p.planLengthLabel,
          meals_per_week: p.mealsPerWeek,
          goal_label: p.goalLabel,
          meals_label: p.mealsLabel,
          amount_paid: p.amountPaid,
          voucher_code: p.voucherCode ?? null,
          voucher_discount: p.voucherDiscount ?? 0,
          payment_status: p.paymentStatus ?? 'pending',
          // WEC-797: previously missing on admin copies → «Τρόπος πληρωμής» and
          // «Ημερομηνία έναρξης» rendered «—» on every internal notification.
          payment_method: p.paymentMethod ?? null,
          plan_start_date: p.planStartDate ?? null,
          plan_start_date_formatted: p.planStartDate ? p.planStartDate.split('-').reverse().join('/') : null,
          walletPlanId: p.walletPlanId,
        },
      )
    }
  } catch (e) {
    console.warn('[notifySubscriptionAdmins] failed:', e)
  }
}
