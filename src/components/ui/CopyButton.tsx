// WEC-556 (O17) — small "copy to clipboard" button used next to bank-transfer
// details (IBAN, payment reference). Bilingual, shows an "Αντιγράφηκε! / Copied!"
// confirmation for ~1.6s, and falls back to a hidden-textarea + execCommand when
// the async Clipboard API is unavailable (non-HTTPS contexts, older Safari).

import { useEffect, useRef, useState } from 'react'

interface CopyButtonProps {
  value: string
  lang: 'el' | 'en'
  /** Accessible label, e.g. "Αντιγραφή IBAN". Falls back to a generic "Copy". */
  ariaLabel?: string
}

export function CopyButton({ value, lang, ariaLabel }: CopyButtonProps) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current)
    },
    [],
  )

  async function handleCopy() {
    const text = (value ?? '').toString()
    let ok = false
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
        ok = true
      }
    } catch {
      ok = false
    }
    if (!ok) {
      // Fallback: hidden textarea + execCommand for non-secure contexts.
      try {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.setAttribute('readonly', '')
        ta.style.position = 'absolute'
        ta.style.left = '-9999px'
        document.body.appendChild(ta)
        ta.select()
        ok = document.execCommand('copy')
        document.body.removeChild(ta)
      } catch {
        ok = false
      }
    }
    if (ok) {
      setCopied(true)
      if (timer.current) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setCopied(false), 1600)
    }
  }

  return (
    <button
      type="button"
      className={`copy-btn${copied ? ' copied' : ''}`}
      onClick={handleCopy}
      aria-label={ariaLabel ?? (lang === 'el' ? 'Αντιγραφή' : 'Copy')}
    >
      {copied ? (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
      <span>{copied ? (lang === 'el' ? 'Αντιγράφηκε!' : 'Copied!') : (lang === 'el' ? 'Αντιγραφή' : 'Copy')}</span>
    </button>
  )
}
