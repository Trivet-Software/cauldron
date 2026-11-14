// eslint.config.js
// Flat config (ESLint 9) for the Cauldron monorepo — supports TypeScript and React/JSX.
// The root `lint` script (`eslint .`) picks this up automatically.
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactPlugin from 'eslint-plugin-react'
import reactHooksPlugin from 'eslint-plugin-react-hooks'

// Privileged database access guards (01.5-backend-foundation, task 1.3, Requirement 4.3).
// The services connect with a privileged connection string, so tenancy depends on every
// user query going through withActor(). Only the modules below may touch the raw driver
// or the RLS-bypassing system actor. Flat config doesn't merge rule options, so each
// override below restates the restrictions that still apply to it.
const postgresImport = {
  name: 'postgres',
  message:
    'The raw postgres driver is privileged. Use withActor() from @cauldron/core/db; only core/src/db/** and core/src/queue/** may import postgres.',
}
const systemActorImport = {
  name: '@cauldron/core/db/system',
  message:
    'The system actor bypasses RLS. Only the API app-goal registration module (services/api/src/goals/register-app-goals.ts) may import it.',
}
// Deep or relative paths to the same module, so the subpath rule can't be sidestepped.
const systemActorPatterns = {
  group: [
    '**/db/system',
    '**/db/system.ts',
    '**/db/system.js',
    '@cauldron/core/src/**',
    // The bare subpath is covered by systemActorImport; don't report it twice.
    '!@cauldron/core/db/system',
  ],
  message:
    'Import @cauldron/core through its exports map. The system actor (core/src/db/system) is reserved for the API app-goal registration module.',
}

// Cross-tenant stale-embedding reads (task 3.2, Requirement 7.6). They run on the privileged
// pool, so only the two modules that report or schedule re-embedding may import them.
const maintenanceModules = [
  'services/api/src/routes/health.ts',
  'services/worker/src/maintenance.ts',
]
const maintenanceImport = {
  name: '@cauldron/core/db/maintenance',
  message: `Cross-tenant embedding reads bypass RLS. Only ${maintenanceModules.join(' and ')} may import them.`,
}
const maintenancePatterns = {
  group: [
    '**/db/maintenance',
    '**/db/maintenance.ts',
    '**/db/maintenance.js',
    // The bare subpath is covered by maintenanceImport; don't report it twice.
    '!@cauldron/core/db/maintenance',
  ],
  message:
    'Import @cauldron/core through its exports map. core/src/db/maintenance is reserved for /health and the re-embed scheduler.',
}

// goal-engine's startup registration of apps/*/goal.json (goal-engine Requirement 8).
// The module doesn't exist yet; keep this path in sync when it lands.
const registrationModule = 'services/api/src/goals/register-app-goals.ts'

export default [
  // Ignore generated and build artifacts
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/routeTree.gen.ts'],
  },
  // Base JS rules
  js.configs.recommended,
  // TypeScript rules
  ...tseslint.configs.recommended,
  // React + JSX
  {
    files: ['**/*.{ts,tsx,js,jsx}'],
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
    },
    languageOptions: {
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      ...reactPlugin.configs.recommended.rules,
      ...reactPlugin.configs['jsx-runtime'].rules,
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
    settings: {
      react: { version: 'detect' },
    },
  },
  // Privileged database access: default for every file.
  {
    files: ['**/*.{ts,tsx,js,jsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [postgresImport, systemActorImport, maintenanceImport],
          patterns: [systemActorPatterns, maintenancePatterns],
        },
      ],
    },
  },
  // core/src/db owns the driver and defines the system actor; its internal imports are free.
  {
    files: ['core/src/db/**/*.{ts,tsx,js,jsx}'],
    rules: { 'no-restricted-imports': 'off' },
  },
  // The queue claims and reaps across tenants, so it needs the driver, not the system actor.
  {
    files: ['core/src/queue/**/*.{ts,tsx,js,jsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [systemActorImport, maintenanceImport],
          patterns: [systemActorPatterns, maintenancePatterns],
        },
      ],
    },
  },
  // The registration module may use the system actor, but not the raw driver.
  {
    files: [registrationModule],
    rules: {
      'no-restricted-imports': ['error', { paths: [postgresImport, maintenanceImport] }],
    },
  },
  // /health and the re-embed scheduler may read stale-embedding counts across tenants, but
  // not the raw driver or the system actor.
  {
    files: maintenanceModules,
    rules: {
      'no-restricted-imports': [
        'error',
        { paths: [postgresImport, systemActorImport], patterns: [systemActorPatterns] },
      ],
    },
  },
]
