---
name: dockerize-design
description: Design for adding Docker build + deployment infrastructure to the waxseal monorepo
metadata:
  type: project
---

# Dockerize Waxseal — Design Spec

**Date:** 2026-07-05

## Goal

Add Docker infrastructure to the monorepo with two purposes:

1. **Extension build container** — reproducibly builds the WXT browser extension and exports artifacts to a host-mounted volume.
2. **Docs deployment container** — serves the Next.js fumadocs site in production.

A root `docker-compose.yml` ties both together for local use. Local development (`bun run dev`) is unchanged.

---

## Files Added

```
apps/
  extension/Dockerfile        # multi-stage extension builder
  fumadocs/Dockerfile         # multi-stage docs server
docker-compose.yml            # root compose file
.dockerignore                 # root ignore file
```

`next.config.mjs` in `apps/fumadocs/` is modified to add `output: 'standalone'`.

---

## Extension Builder (`apps/extension/Dockerfile`)

Four stages:

| Stage | Base image | What it does |
|---|---|---|
| `base` | `oven/bun:1.2.20-alpine` | Sets `WORKDIR /repo` |
| `installer` | `base` | Copies root manifests + all workspace `package.json` files; runs `bun install --frozen-lockfile` |
| `builder` | `installer` | Copies all source; runs `bunx turbo run build --filter=extension` |
| `exporter` | `alpine:3.21` | Copies `.output/` from builder into `/artifacts/`; entrypoint `cp -r /artifacts/. /out/` |

**Usage:**

```sh
docker compose run --rm extension-builder
# ZIPs and unpacked extension land in ./dist/ on the host
```

The `exporter` stage is a minimal Alpine image — it holds no build tooling. The container exits immediately after copying artifacts.

WXT writes built output to `apps/extension/.output/chrome-mv3/`. The exporter copies the entire `.output/` tree so both Chrome and Firefox artifacts are captured when both targets are built.

---

## Docs Server (`apps/fumadocs/Dockerfile`)

Four stages:

| Stage | Base image | What it does |
|---|---|---|
| `base` | `oven/bun:1.2.20-alpine` | Sets `WORKDIR /repo` |
| `installer` | `base` | Copies root manifests + all workspace `package.json` files; runs `bun install --frozen-lockfile` |
| `builder` | `installer` | Copies all source; sets `NEXT_TELEMETRY_DISABLED=1`; runs `bunx turbo run build --filter=fumadocs` |
| `runner` | `node:22-alpine` | Copies `.next/standalone/` and `.next/static/`; exposes port 4000; entrypoint `node server.js` |

The `runner` stage uses Node (not Bun) because Next.js standalone output targets Node and is not tested on Bun.

**Prerequisite:** `apps/fumadocs/next.config.mjs` must include `output: 'standalone'` so Next.js bundles its server and dependencies into `.next/standalone/`.

---

## `docker-compose.yml` (root)

```yaml
services:
  docs:
    build:
      context: .
      dockerfile: apps/fumadocs/Dockerfile
    ports:
      - "4000:4000"
    environment:
      - NODE_ENV=production

  extension-builder:
    build:
      context: .
      dockerfile: apps/extension/Dockerfile
    volumes:
      - ./dist:/out
    profiles:
      - tools
```

- `docker compose up` — starts only `docs` (extension-builder is in the `tools` profile, excluded by default).
- `docker compose run --rm extension-builder` — builds the extension and writes artifacts to `./dist/` on the host.

---

## `.dockerignore` (root)

Excludes directories that must not be sent to the build context:

```
node_modules
**/node_modules
.next
**/.next
.output
**/.output
dist
.turbo
**/.turbo
dev-dist
chrome
.git
e2e
```

This keeps the build context small and prevents stale local build outputs from shadowing fresh in-container builds.

---

## `next.config.mjs` Change

Add `output: 'standalone'` to the existing config object in `apps/fumadocs/next.config.mjs`:

```js
const config = {
  reactStrictMode: true,
  output: 'standalone',
};
```

This is the only change to existing source files.

---

## What Is Not Covered

- Remote cache (TurboRepo) — not needed; can be added later.
- Extension signing / store publishing — out of scope; artifacts are exported unpackaged.
- CI pipeline integration — Dockerfiles are ready to use in GitHub Actions but no workflow files are added here.
- Multi-platform builds (`--platform linux/amd64,linux/arm64`) — not in scope; can be added to Compose later.
