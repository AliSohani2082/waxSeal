# syntax=docker/dockerfile:1

# ── Stage 1: base ──────────────────────────────────────────────────────────────
FROM oven/bun:1.2.20-alpine AS base
WORKDIR /repo

# ── Stage 2: installer ─────────────────────────────────────────────────────────
# Copy package manifests first so this layer is cached until dependencies change.
# --ignore-scripts skips wxt postinstall (needs source files not present yet).
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
# root vite@^8 pins WXT's transitive vite to >=8; Vite 5 breaks WXT's load filter API in Docker
RUN bun install --frozen-lockfile --ignore-scripts

# ── Stage 3: builder ───────────────────────────────────────────────────────────
# WXT runs its own prepare step internally during `wxt build`, so no separate
# wxt prepare call is needed here.
FROM installer AS builder
COPY . .
RUN bunx turbo run build --filter=extension

# ── Stage 4: exporter ──────────────────────────────────────────────────────────
# Minimal Alpine image — no build tooling. Copies artifacts to /out on the host
# when run with: docker run --rm -v ./dist:/out <image>
FROM alpine:3.21 AS exporter
COPY --from=builder /repo/apps/extension/.output /artifacts
CMD ["/bin/sh", "-c", "cp -r /artifacts/. /out/"]
