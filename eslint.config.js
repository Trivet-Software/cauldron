// eslint.config.js
// Flat config (ESLint 9) for the Cauldron monorepo — supports TypeScript and React/JSX.
// The root `lint` script (`eslint .`) picks this up automatically.
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactPlugin from 'eslint-plugin-react'
import reactHooksPlugin from 'eslint-plugin-react-hooks'

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
]
