import { useEffect } from 'react'
import { useUIStore } from './store/useUIStore'
import { useAuthStore } from './store/useAuthStore'
import { supabase } from './lib/supabase'
import { Header } from './components/layout/Header'
import { Toast } from './components/ui/Toast'
import { MenuPage } from './pages/MenuPage'
import { CheckoutPage } from './pages/CheckoutPage'
import { AccountPage } from './pages/AccountPage'
import { WalletPage } from './pages/WalletPage'
import { DishModal } from './components/menu/DishModal'
import { AuthModal } from './components/layout/AuthModal'
import { WalletModal } from './components/wallet/WalletModal'

export default function App() {
  const isCheckout = useUIStore((s) => s.isCheckout)
  const isAccountPage = useUIStore((s) => s.isAccountPage)
  const isWalletPage = useUIStore((s) => s.isWalletPage)

  // Rehydrate session on mount + listen for auth state changes
  useEffect(() => {
    useAuthStore.getState().checkSession()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === 'SIGNED_OUT' || !session) {
          useAuthStore.getState().setUser(null)
        } else if (event === 'SIGNED_IN' && session.user) {
          // Only refresh if we don't already have this user loaded
          // (login() already loaded the user, this handles external sign-ins)
          const current = useAuthStore.getState().user
          if (!current || current.id !== session.user.id) {
            useAuthStore.getState().refreshUser(session.user.id)
          }
        }
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  return (
    <>
      <Header />
      <main>
        {isCheckout ? (
          <CheckoutPage />
        ) : isAccountPage ? (
          <AccountPage />
        ) : isWalletPage ? (
          <WalletPage />
        ) : (
          <MenuPage />
        )}
      </main>

      {/* Global modals */}
      <DishModal />
      <AuthModal />
      <WalletModal />
      <Toast />
    </>
  )
}
