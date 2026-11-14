# One image recipe for the static apps, served by Caddy.
# Build: docker build -f Dockerfile.app --build-arg APP=recipe-box \
#   --build-arg VITE_CLERK_PUBLISHABLE_KEY=pk_... --build-arg VITE_API_BASE_URL=https://... .
FROM node:24-slim AS build
ARG APP
ARG VITE_CLERK_PUBLISHABLE_KEY
ARG VITE_API_BASE_URL
RUN test -n "${APP}" || (echo "APP build arg is required (e.g. recipe-box)" >&2; exit 1)
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter "${APP}..."
# Vite inlines VITE_* variables into the bundle at build time.
ENV VITE_CLERK_PUBLISHABLE_KEY=${VITE_CLERK_PUBLISHABLE_KEY}
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
RUN pnpm --filter "${APP}" build

FROM caddy:2-alpine
ARG APP
ENV SITE_ROOT=/srv
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/${APP}/dist /srv
