import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import { fileURLToPath } from 'node:url'


export default defineConfig({
  plugins: [
    TanStackRouterVite({ target: 'react', autoCodeSplitting: true }),
    react(),
  ],
  // Load .env / .env.local from the repo root, next to .env.example, so both
  // apps share one env file (Requirement 5.1).
  envDir: fileURLToPath(new URL('../..', import.meta.url)),
  // Expose VITE_* plus exactly CLERK_PUBLISHABLE_KEY (what `clerk env pull`
  // writes). CLERK_SECRET_KEY doesn't match either prefix, so it never ships.
  envPrefix: ['VITE_', 'CLERK_PUBLISHABLE_KEY'],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
})
