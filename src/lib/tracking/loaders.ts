// Browser SDK loaders (WEC-397). Each loads its third-party script once, lazily.
// Callers (initTracking / consent change) decide WHEN to load based on the master
// switch + consent. GA4 / Google Ads are deferred to phase 2 — no gtag loader yet.

import { trackingConfig } from './config'

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    fbq?: any
    _fbq?: any
    klaviyo?: any[]
  }
}

let pixelLoaded = false
let klaviyoLoaded = false

/** Meta Pixel — load fbevents.js + init. Gate on ads consent in the caller. */
export function loadMetaPixel(): void {
  if (pixelLoaded || typeof window === 'undefined') return
  const id = trackingConfig.metaPixelId
  if (!id) return
  ;(function (f: any, b: Document, e: string, v: string) {
    if (f.fbq) return
    const n: any = (f.fbq = function (...args: unknown[]) {
      n.callMethod ? n.callMethod.apply(n, args) : n.queue.push(args)
    })
    if (!f._fbq) f._fbq = n
    n.push = n
    n.loaded = true
    n.version = '2.0'
    n.queue = []
    const t = b.createElement(e) as HTMLScriptElement
    t.async = true
    t.src = v
    const s = b.getElementsByTagName(e)[0]
    s.parentNode?.insertBefore(t, s)
  })(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js')

  window.fbq('init', id)
  pixelLoaded = true
}

export function isPixelLoaded(): boolean {
  return pixelLoaded
}

/** Klaviyo onsite.js — enables client-side behavioral events (Viewed Product,
 *  Added to Cart, …). Gate on analytics consent in the caller. */
export function loadKlaviyo(): void {
  if (klaviyoLoaded || typeof window === 'undefined') return
  const key = trackingConfig.klaviyoPublicKey
  if (!key) return
  window.klaviyo = window.klaviyo || []
  const s = document.createElement('script')
  s.async = true
  s.src = `https://static.klaviyo.com/onsite/js/klaviyo.js?company_id=${encodeURIComponent(key)}`
  document.head.appendChild(s)
  klaviyoLoaded = true
}

export function isKlaviyoLoaded(): boolean {
  return klaviyoLoaded
}
