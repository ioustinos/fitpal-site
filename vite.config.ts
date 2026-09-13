import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    // WEC-762: Netlify sets COMMIT_REF at build time, but Vite only exposes
    // VITE_-prefixed vars to the browser. Injecting it here is what makes
    // "which deploy broke this?" a single click in Sentry. Falls back to
    // 'dev-local' so a local build is obviously not a deploy.
    'import.meta.env.VITE_COMMIT_REF': JSON.stringify(
      process.env.COMMIT_REF ?? process.env.VITE_COMMIT_REF ?? 'dev-local',
    ),
  },
})
