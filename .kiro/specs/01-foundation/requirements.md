# Requirements Document

Lives across `/web-kit` and `/apps/recipe-box` (or a shared app shell). This is the first spec to implement — everything else builds on top of it.

## Introduction

The foundation spec delivers the smallest deployable app that proves the tech stack works end to end: a monorepo structure, a web app shell with routing and theming, Clerk authentication, and a public deployment. No goal-engine, capture, or search features yet — just the skeleton that those features will plug into.

## Requirements

### Requirement 1: Monorepo structure
**User Story:** As a developer, I want a clean repo layout from the start, so that each spec area has a home and the build doesn't need restructuring later.
#### Acceptance Criteria
1. WHEN the repo is scaffolded, THE SYSTEM SHALL contain `/core`, `/web-kit`, `/apps/recipe-box`, `/apps/research-library` directories.
2. WHEN the web app is built, THE SYSTEM SHALL share `/web-kit` as a package or module that both apps import.
3. WHEN dependencies are installed, THE SYSTEM SHALL use a single workspace lockfile (pnpm, npm workspaces, or equivalent).
4. WHEN the repo is cloned, THE SYSTEM SHALL include a root `package.json` with workspace configuration and a `.gitignore` already present.

### Requirement 2: Web app shell with routing
**User Story:** As a user, I want to open the app and see a working page, so that I know the stack is alive before features are built.
#### Acceptance Criteria
1. WHEN the dev server starts, THE SYSTEM SHALL serve a web app built with Vite + TanStack Router.
2. WHEN the app loads, THE SYSTEM SHALL show a home page with a header and navigation placeholder.
3. WHEN the user navigates between routes, THE SYSTEM SHALL use TanStack Router with type-safe file-based routes.
4. WHEN the app renders, THE SYSTEM SHALL use shadcn/ui components and Tailwind CSS for all styling.
5. WHEN a shared theme is applied, THE SYSTEM SHALL use Tailwind CSS variables so the theme can be swapped later.

### Requirement 3: Clerk authentication
**User Story:** As a user, I want to sign in and sign out, so that my data is protected and the app knows who I am.
#### Acceptance Criteria
1. WHEN the app initializes, THE SYSTEM SHALL configure `@clerk/clerk-react` with publishable and secret keys from environment variables.
2. WHEN an unauthenticated user visits a protected route, THE SYSTEM SHALL redirect them to a sign-in page using TanStack Router `beforeLoad` guards.
3. WHEN a user signs in, THE SYSTEM SHALL offer Clerk's hosted sign-in component (email, OAuth, or whichever providers are configured in the Clerk dashboard).
4. WHEN a user is signed in, THE SYSTEM SHALL display their identity (name or email) and a sign-out action in the header.
5. WHEN a user signs out, THE SYSTEM SHALL redirect them to the home page.
6. WHEN the app makes API calls, THE SYSTEM SHALL include the Clerk session token in the Authorization header.

### Requirement 4: Public and protected route pattern
**User Story:** As a developer, I want the route structure to support both public and protected pages, so that the anonymous read-only demo and the signed-in features can coexist.
#### Acceptance Criteria
1. WHEN an anonymous visitor opens the home page, THE SYSTEM SHALL show it without requiring sign-in.
2. WHEN an anonymous visitor opens a protected route (e.g. a future capture or goal-creation page), THE SYSTEM SHALL redirect to sign-in.
3. WHEN the route tree is defined, THE SYSTEM SHALL mark protected routes with a `beforeLoad` check that reads Clerk's auth state.

### Requirement 5: Environment configuration
**User Story:** As a developer, I want env vars managed cleanly, so that local dev and deployment both work without code changes.
#### Acceptance Criteria
1. WHEN the app runs locally, THE SYSTEM SHALL load environment variables from a `.env.local` file (gitignored).
2. WHEN the app runs in production, THE SYSTEM SHALL read environment variables from Railway's variable configuration.
3. WHEN a new developer sets up the project, THE SYSTEM SHALL provide a `.env.example` file documenting required variables (Clerk publishable key, Clerk secret key, API base URL).
4. WHEN the app starts, THE SYSTEM SHALL validate that required environment variables are present and fail fast with a clear message if any are missing.
5. WHEN the project is deployed to Railway, THE SYSTEM SHALL include a `railway.json` or `nixpacks.toml` config that specifies the build command (`vite build`) and the static output directory (`dist/`).
6. WHEN Railway builds the app, THE SYSTEM SHALL pass environment variables through Vite's `define` or `import.meta.env` so the Clerk publishable key is available client-side.

### Requirement 6: Deployment to Railway
**User Story:** As an operator, I want the app deployed to Railway at a public URL, so that I can share it and judges can visit it.
#### Acceptance Criteria
1. WHEN the app is built, THE SYSTEM SHALL produce a static SPA bundle in `dist/` ready for Railway to serve.
2. WHEN the app is deployed to Railway, THE SYSTEM SHALL serve it at a public URL accessible from a browser.
3. WHEN a deployed build starts on Railway, THE SYSTEM SHALL have the Clerk publishable key available as an environment variable.
4. WHEN the SPA is deployed, THE SYSTEM SHALL handle client-side routing with a fallback to `index.html` for all routes.
5. WHEN the deployment is complete, THE SYSTEM SHALL be verified by opening the public URL in a browser and confirming the app loads and the Clerk sign-in page renders.
6. WHEN a signed-in user visits the deployed app, THE SYSTEM SHALL show their identity in the header, confirming auth works end to end in production.

### Requirement 7: Build and dev tooling
**User Story:** As a developer, I want linting and type-checking from day one, so that code quality is enforced as features are added.
#### Acceptance Criteria
1. WHEN the project is set up, THE SYSTEM SHALL include TypeScript with strict mode enabled.
2. WHEN a file is saved, THE SYSTEM SHALL run ESLint via a Kiro hook (PostFileSave).
3. WHEN the dev server runs, THE SYSTEM SHALL provide hot module replacement via Vite.
4. WHEN `build` is run, THE SYSTEM SHALL type-check and produce a production bundle with no errors.
