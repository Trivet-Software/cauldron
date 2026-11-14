import { defineConfig } from 'tsup'

// The runtime image copies only dist/ (Dockerfile.service, 01.5-backend-foundation
// design "Deployment"), so the bundle must carry @cauldron/core and every npm
// dependency. Node built-ins stay external because platform is 'node'.
export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'node24',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  noExternal: [/.*/],
  // Bundled CommonJS dependencies (pino, postgres) call require() for Node
  // built-ins, which an ESM bundle doesn't define without this shim.
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'\nconst require = __createRequire(import.meta.url)",
  },
})
