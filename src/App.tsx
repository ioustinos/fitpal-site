import { useUIStore } from './store/useUIStore'
import { Header } from './components/layout/Header'
import { Toast } from './components/ui/Toast'
import { MenuPage } from './pages/MenuPage'
import { CheckoutPage } from './pages/CheckoutPage'
import { AccountPage } from './pages/AccountPage'
import { DishModal } from './components/menu/DishModal'
import { AuthModal } from './components/layout/AuthModal'
import { WalletModal } from './components/wallet/WalletModal'

export default function App() {
  const isCheckout = useUIStore((s) => s.isCheckout)
  const isAccountPage = useUIStore((s) => s.isAccountPage)

  return (
    <>
      <Header />
      <main>
        {isCheckout ? (
          <CheckoutPage />
        ) : isAccountPage ? (
          <AccountPage />
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
