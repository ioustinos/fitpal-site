import { createContext, useContext } from 'react'
import type { MyPartner } from './api'

export const PartnerContext = createContext<MyPartner | null>(null)
export function usePartner(): MyPartner {
  const p = useContext(PartnerContext)
  if (!p) throw new Error('usePartner outside PartnerApp')
  return p
}
