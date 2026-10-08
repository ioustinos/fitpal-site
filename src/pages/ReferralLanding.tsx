/**
 * WEC-852 (hidden add-on) — /ref/<code>: a dietitian's referral link.
 * Remembers the code and sends the visitor to the menu. The code is claimed by
 * <PartnerLinkPrompt/> once they are signed in (signup or login); the server
 * ignores it unless that partner has the referral add-on switched on.
 */
import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { REF_STORAGE_KEY } from '../components/partner/PartnerLinkPrompt'

export function ReferralLanding() {
  const { code } = useParams()
  const navigate = useNavigate()
  useEffect(() => {
    const c = (code ?? '').trim()
    if (/^[A-Za-z0-9_-]{2,40}$/.test(c)) {
      try { localStorage.setItem(REF_STORAGE_KEY, c) } catch { /* private mode */ }
    }
    navigate('/', { replace: true })
  }, [code, navigate])
  return null
}
