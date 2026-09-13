import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { initSentry, Sentry } from './lib/monitoring/sentry'
import { ErrorFallback } from './components/ErrorFallback'

// WEC-762: before anything renders, so a crash during the very first paint is
// still reported. No-ops entirely when VITE_SENTRY_DSN is unset.
initSentry()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* A render crash used to leave a white page and no signal. Now the
        customer gets a way out and we get the stack trace. */}
    <Sentry.ErrorBoundary fallback={({ resetError }) => <ErrorFallback onReset={resetError} />}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </Sentry.ErrorBoundary>
  </StrictMode>,
)
