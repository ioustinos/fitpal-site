import { lazy, Suspense, useEffect } from 'react'
import { Routes, Route } from 'react-router-dom'
import { useUIStore } from './store/useUIStore'
import { useAuthStore } from './store/useAuthStore'
import { supabase } from './lib/supabase'
import { Header } from './components/layout/Header'
import { Toast } from './components/ui/Toast'
import { MenuPage } from './pages/MenuPage'
import { CheckoutPage } from './pages/CheckoutPage'
import { AccountPage } from './pages/AccountPage'
import { WalletPage } from './pages/WalletPage'
import { OrderReturn } from './pages/OrderReturn'
import { DishModal } from './components/menu/DishModal'
import { AuthModal } from './components/layout/AuthModal'
import { WalletModal } from './components/wallet/WalletModal'
import { ImpersonationBanner } from './components/admin/ImpersonationBanner'

// Admin is lazy-loaded so the customer bundle stays lean — /admin/* code
// won't be fetched until a user actually visits the admin panel.
const AdminApp = lazy(() => import('./admin/AdminApp'))

/** The existing customer site — unchanged, still driven by useUIStore. */
function CustomerApp() {
  const isCheckout = useUIStore((s) => s.isCheckout)
  const isAccountPage = useUIStore((s) => s.isAccountPage)
  const isWalletPage = useUIStore((s) => s.isWalletPage)

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

export default function App() {
  // Rehydrate session on mount + listen for auth state changes.
  // These effects run regardless of which route is active, so both
  // the customer site and /admin get a populated user when the app starts.
  useEffect(() => {
    useAuthStore.getState().checkSession()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === 'SIGNED_OUT' || !session) {
          useAuthStore.getState().setUser(null)
          // Belt-and-braces: any sign-out — whether admin clicked our
          // Sign Out button, the session expired, or another tab signed
          // out — should drop impersonation state. The Sign Out button
          // handler also clears it (in useAuthStore.logout) but external
          // sign-outs route here without going through that handler.
          try {
            const { useImpersonationStore } = await import('./store/useImpersonationStore')
            const imp = useImpersonationStore.getState()
            if (imp.active) {
              useImpersonationStore.setState({
                active: false, target: null, adminSession: null,
                loading: false, error: null,
              })
            }
          } catch { /* non-fatal */ }
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

    // WEC-141: on login (or session rehydrate), seed the UI language from the
    // user's saved preference (Account → Preferences). The header toggle is
    // session-only, so this is how cross-device language choice sticks.
    const unsubAuth = useAuthStore.subscribe((state, prevState) => {
      const newUserId = state.user?.id
      const prevUserId = prevState.user?.id
      if (newUserId && newUserId !== prevUserId) {
        const savedLang = state.user?.prefs?.lang
        if (savedLang === 'el' || savedLang === 'en') {
          useUIStore.setState({ lang: savedLang })
        }
      }
    })

    return () => {
      subscription.unsubscribe()
      unsubAuth()
    }
  }, [])

  return (
    <>
      {/* Impersonation banner mounts globally — visible across customer pages,
          admin pages, return URLs, etc. The banner pushes content via the
          `is-impersonating` body class. */}
      <ImpersonationBanner />
      <Routes>
        <Route
          path="/admin/*"
          element={
            <Suspense fallback={<AdminBootFallback />}>
              <AdminApp />
            </Suspense>
          }
        />
        {/* WEC-172 — Viva return landing pages. These sit outside the zustand
            customer shell because they need URL + query-param access. */}
        <Route path="/order/pending/success" element={<OrderReturn mode="success" />} />
        <Route path="/order/pending/failure" element={<OrderReturn mode="failure" />} />
        <Route path="*" element={<CustomerApp />} />
      </Routes>
    </>
  )
}

/** Inline fallback — admin.css isn't loaded yet when this renders. */
function AdminBootFallback() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#f6f7f9',
        color: '#6b7280',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        fontSize: 14,
      }}
    >
      Loading admin…
    </div>
  )
}
