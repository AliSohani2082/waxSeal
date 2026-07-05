# syntax=docker/dockerfile:1

# ── Stage 1: base ──────────────────────────────────────────────────────────────
FROM oven/bun:1.2.20-alpine AS base
WORKDIR /repo

# ── Stage 2: installer ─────────────────────────────────────────────────────────
# Copy package manifests first so this layer is cached until dependencies change.
# --ignore-scripts skips fumadocs-mdx postinstall (needs source files not present yet).
FROM base AS installer
COPY package.json bun.lock bunfig.toml turbo.json tsconfig.base.json tsconfig.json ./
COPY apps/extension/package.json ./apps/extension/
COPY apps/fumadocs/package.json ./apps/fumadocs/
COPY packages/adapters/adapter-api/package.json ./packages/adapters/adapter-api/
COPY packages/adapters/adapter-bale/package.json ./packages/adapters/adapter-bale/
COPY packages/build/package.json ./packages/build/
COPY packages/config/package.json ./packages/config/
COPY packages/crypto-core/package.json ./packages/crypto-core/
COPY packages/extension-core/package.json ./packages/extension-core/
COPY e2e/package.json ./e2e/
RUN bun install --frozen-lockfile --ignore-scripts

# ── Stage 3: builder ───────────────────────────────────────────────────────────
# fumadocs-mdx generates .source/ (normally done via postinstall, but we skipped
# scripts in the installer stage, so we run it explicitly here with source present).
FROM installer AS builder
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN cd apps/fumadocs && bunx fumadocs-mdx
RUN bunx turbo run build --filter=fumadocs

# ── Stage 4: runner ────────────────────────────────────────────────────────────
# node:22-alpine — Next.js standalone server.js targets Node, not Bun.
# HOSTNAME=0.0.0.0 binds to all interfaces (required inside a container).
# Nested monorepo path — standalone output lands under the app's relative path:
#   apps/fumadocs/.next/standalone/apps/fumadocs/server.js
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=4000
ENV HOSTNAME=0.0.0.0
COPY --from=builder /repo/apps/fumadocs/.next/standalone ./
COPY --from=builder /repo/apps/fumadocs/.next/static ./apps/fumadocs/.next/static
RUN addgroup -S nodejs && adduser -S nextjs -G nodejs
USER nextjs
EXPOSE 4000
CMD ["node", "apps/fumadocs/server.js"]
