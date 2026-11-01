# Code Style

No Prettier or EditorConfig is configured. These rules describe what the existing code does; match them. ESLint (`pnpm lint`) and `tsc` (`pnpm typecheck`) are the enforced checks.

## Formatting

- 2-space indent, single quotes, no semicolons, trailing commas in multiline literals and argument lists.
- Imports use ESM only. Order: external packages, then `@/` alias or workspace packages, then relative imports.
- Use `node:` prefix for Node built-ins (e.g. `import path from 'node:path'`).

## TypeScript

- Strict mode. No unused locals or parameters; prefix intentionally unused params with `_` only if unavoidable.
- Avoid `any`. Use `unknown` and narrow, or type the value properly. `tseslint.configs.recommended` flags `any`.
- Use `interface` for object shapes that are exported (e.g. `AppEnv`), `type` for unions and aliases.
- Use `import { type X }` for type-only imports (`isolatedModules` is on).
- Exported functions get explicit parameter types; return types may be inferred for small functions.
- Never edit generated files such as `routeTree.gen.ts`.

## React

- Function components only, declared as `function Name() {}` (not arrow-assigned consts).
- Named exports for shared components. Route files export `Route` via `createFileRoute`.
- Follow hooks rules: `rules-of-hooks` is an error, `exhaustive-deps` is a warning, so do not suppress it without a comment explaining why.
- Keep components in a folder with an `index.tsx` (e.g. `web-kit/src/components/header/index.tsx`) and re-export from `components/index.ts`.

## Styling

- Tailwind utility classes only. Use semantic theme tokens (`bg-background`, `text-foreground`, `border`) instead of raw colors, so theming stays a data change.
- Compose conditional classes with `cn()` from `web-kit/lib/utils`.
- Prefer shadcn/ui components from `web-kit` over hand-rolled equivalents. Add new shared components to `web-kit`, not to an app, when both apps could use them.

## Environment and Secrets

- Read env vars through the app's `validateEnv()` result, not by scattering `import.meta.env` reads.
- Never prefix server-only secrets with `VITE_`. Never log or hard-code keys.

## Comments

- Explain why, not what. Keep file-level comments for non-obvious decisions (see `Caddyfile`, `theme.css`).
- Reference the spec requirement or task when code exists to satisfy one.
