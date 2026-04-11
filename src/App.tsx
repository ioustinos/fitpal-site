import { useUIStore } from './store/useUIStore'
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
