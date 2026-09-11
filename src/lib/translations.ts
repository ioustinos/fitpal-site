// ═══════════════════════════════════════════════════════════════════════════
//  UI strings — public API
//
//  WEC-728. The string table used to live here as one flat 871-line object.
//  That single namespace is *why* the codebase drifted into 493 inline
//  bilingual ternaries: adding a key meant editing the one file every other
//  chat was also editing, so people inlined instead. It is now split into
//  src/lib/i18n/<section>.ts and merged back together here.
//
//  ⚠️ NOTHING ABOUT THE PUBLIC API CHANGED. `t('cartTitle')`, `tr(lang, key)`
//  and the `TKey` type behave exactly as before — the split is invisible to
//  every component. Do not "simplify" this back into one file.
//
//  WHERE TO ADD A STRING: the module it belongs to, never a global bucket.
//  The module list is also what groups the keys in /admin/copy (WEC-735), so
//  a key in the wrong module is a key the team cannot find.
// ═══════════════════════════════════════════════════════════════════════════

import { common } from './i18n/common'
import { menu } from './i18n/menu'
import { cart } from './i18n/cart'
import { checkout } from './i18n/checkout'
import { account } from './i18n/account'
import { wallet } from './i18n/wallet'
import { auth } from './i18n/auth'
import { errors } from './i18n/errors'
import { getUiStringOverride } from './i18n/overrides'

export type Lang = 'el' | 'en'

/** Every module, in the order they are merged and the order /admin/copy shows
 *  them. Keys are unique across modules — a collision would silently shadow,
 *  so the duplicate-key guard in scripts/check-i18n.mjs fails the build. */
export const I18N_MODULES = { common, menu, cart, checkout, account, wallet, auth, errors } as const
export type I18nModuleName = keyof typeof I18N_MODULES

const T = {
  el: {
    ...common.el, ...menu.el, ...cart.el, ...checkout.el,
    ...account.el, ...wallet.el, ...auth.el, ...errors.el,
  },
  en: {
    ...common.en, ...menu.en, ...cart.en, ...checkout.en,
    ...account.en, ...wallet.en, ...auth.en, ...errors.en,
  },
} as const

export type TKey = keyof typeof T['en']

export function tr(lang: Lang, key: TKey): string {
  // WEC-734: an admin override wins over the compiled default. getUiStringOverride
  // returns undefined for "no override" AND for an empty override, so a blank
  // field in /admin/copy restores the default rather than blanking the label.
  // The file value remains the last line of defence — this layer can only ever
  // improve on it, never remove it.
  return getUiStringOverride(lang, key) ?? (T[lang] as Record<string, string>)[key] ?? key
}

/** Hook-friendly shorthand — call useLang() to get a bound tr */
export function makeTr(lang: Lang) {
  return (key: TKey) => tr(lang, key)
}
