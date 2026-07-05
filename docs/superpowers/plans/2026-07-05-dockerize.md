# Dockerize Waxseal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Docker build and deployment infrastructure to the waxseal Bun/TurboRepo monorepo — an extension artifact-export container and a fumadocs docs server container.

**Architecture:** Separate Dockerfiles per app share a multi-stage pattern (base → installer → builder → final stage). Both use the monorepo root as the Docker build context so Bun workspace installs resolve correctly. A root `docker-compose.yml` ties both together. `bun install` is run with `--ignore-scripts` in the installer stage; scripts that need source files (fumadocs-mdx, wxt prepare) run in the builder stage instead.

**Tech Stack:** Docker, Bun 1.2.20, TurboRepo 2.x, WXT 0.20.x (browser extension), Next.js (fumadocs), Node 22

## Global Constraints

- Bun base image: `oven/bun:1.2.20-alpine` (matches `packageManager: bun@1.2.20` in root `package.json`)
- Extension exporter image: `alpine:3.21`
- Docs runner image: `node:22-alpine` (Next.js standalone targets Node, not Bun)
- Docker build context is always the **monorepo root** (`.`) for both Dockerfiles
- `bun install` uses `--frozen-lockfile --ignore-scripts` in all installer stages
- Docs site port: `4000` (matches `apps/fumadocs` dev script `--port=4000`)
- `NEXT_TELEMETRY_DISABLED=1` set in fumadocs builder and runner stages
- No new npm/bun dependencies; no existing tests modified
- Turbo filter names match `name` field in each app's `package.json`: `extension`, `fumadocs`

---

### Task 1: Root `.dockerignore`

**Files:**
- Create: `.dockerignore`

**Interfaces:**
- Produces: Exclusion rules applied to every `docker build` invocation in this repo

- [ ] **Step 1: Create `.dockerignore` at the repo root**

Create `/home/ali/Projects/waxseal/.dockerignore` with exactly this content:

```
node_modules
**/node_modules
.next
**/.next
.output
**/.output
.source
**/.source
.wxt
**/.wxt
dist
.turbo
**/.turbo
dev-dist
chrome
.git
e2e
*.tsbuildinfo
```

- [ ] **Step 2: Verify the file exists and reads correctly**

```bash
cat .dockerignore
```

Expected: the file content prints with no errors.

- [ ] **Step 3: Commit**

```bash
git add .dockerignore
git commit -m "chore: add .dockerignore for Docker build context"
```

---

### Task 2: Enable Next.js standalone output in fumadocs

**Files:**
- Modify: `apps/fumadocs/next.config.mjs`

**Interfaces:**
- Produces: `apps/fumadocs/.next/standalone/` directory containing `server.js` after `next build` — consumed by the runner stage in Task 4

- [ ] **Step 1: Add `output: "standalone"` to `next.config.mjs`**

Current content of `apps/fumadocs/next.config.mjs`:

```js
import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
	reactStrictMode: true,
};

export default withMDX(config);
```

Change it to:

```js
import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
	reactStrictMode: true,
	output: "standalone",
};

export default withMDX(config);
```

- [ ] **Step 2: Run the fumadocs build locally to verify standalone output**

```bash
cd apps/fumadocs && bun run build
```

Expected: build completes without errors.

- [ ] **Step 3: Confirm the standalone server.js location**

```bash
find apps/fumadocs/.next/standalone -name "server.js"
```

Expected output (standard path): `apps/fumadocs/.next/standalone/server.js`

In some monorepo setups Next.js nests it: `apps/fumadocs/.next/standalone/apps/fumadocs/server.js`. **Note the actual path** — you will need it in Task 4 Step 1.

- [ ] **Step 4: Commit**

```bash
git add apps/fumadocs/next.config.mjs
git commit -m "feat: enable Next.js standalone output for Docker deployment"
```

---

### Task 3: Extension builder Dockerfile

**Files:**
- Create: `apps/extension/Dockerfile`

**Interfaces:**
- Consumes: `.dockerignore` from Task 1 (must exist before `docker build`)
- Produces: Docker image whose `CMD` copies `apps/extension/.output/` to `/out` at runtime — artifacts land on the host via a volume mount

- [ ] **Step 1: Create `apps/extension/Dockerfile`**

```dockerfile
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
```

- [ ] **Step 2: Build the image**

```bash
docker build -f apps/extension/Dockerfile -t waxseal-extension-builder .
```

Expected: build completes successfully through all four stages. If the builder stage fails at `turbo run build --filter=extension`, first confirm the extension builds locally with `bun run build` in `apps/extension/`.

- [ ] **Step 3: Test artifact export**

```bash
mkdir -p /tmp/waxseal-dist
docker run --rm -v /tmp/waxseal-dist:/out waxseal-extension-builder
ls /tmp/waxseal-dist/
```

Expected: `chrome-mv3/` directory appears in `/tmp/waxseal-dist/`. Verify it contains `manifest.json`:

```bash
cat /tmp/waxseal-dist/chrome-mv3/manifest.json | head -5
```

Expected: valid JSON with `"name": "waxseal"`.

- [ ] **Step 4: Commit**

```bash
git add apps/extension/Dockerfile
git commit -m "feat: add multi-stage Docker extension builder"
```

---

### Task 4: Docs server Dockerfile

**Files:**
- Create: `apps/fumadocs/Dockerfile`

**Interfaces:**
- Consumes: `.dockerignore` from Task 1; `output: "standalone"` in `next.config.mjs` from Task 2; server.js path confirmed in Task 2 Step 3
- Produces: Docker image serving the fumadocs Next.js site on port 4000

**Before starting:** confirm the `server.js` path from Task 2 Step 3. The Dockerfile below uses the standard path `apps/fumadocs/.next/standalone/server.js` — adjust if yours differs.

- [ ] **Step 1: Create `apps/fumadocs/Dockerfile`**

If Task 2 Step 3 found `server.js` at a different path (e.g., `apps/fumadocs/.next/standalone/apps/fumadocs/server.js`), adjust the `COPY --from=builder` destination and `CMD` path accordingly. Otherwise use as-is.

```dockerfile
# syntax=docker/dockerfile:1

# ── Stage 1: base ──────────────────────────────────────────────────────────────
FROM oven/bun:1.2.20-alpine AS base
WORKDIR /repo

# ── Stage 2: installer ─────────────────────────────────────────────────────────
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
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=4000
ENV HOSTNAME=0.0.0.0
COPY --from=builder /repo/apps/fumadocs/.next/standalone ./
COPY --from=builder /repo/apps/fumadocs/.next/static ./.next/static
COPY --from=builder /repo/apps/fumadocs/public ./public
EXPOSE 4000
CMD ["node", "server.js"]
```

- [ ] **Step 2: Build the image**

```bash
docker build -f apps/fumadocs/Dockerfile -t waxseal-docs .
```

Expected: four stages complete; final image tagged `waxseal-docs`.

If the `COPY --from=builder /repo/apps/fumadocs/.next/standalone` step fails, the standalone path differs from standard. Debug with:

```bash
docker build -f apps/fumadocs/Dockerfile --target builder -t waxseal-docs-builder .
docker run --rm waxseal-docs-builder find /repo/apps/fumadocs/.next/standalone -name server.js
```

Use the path printed to correct the `COPY` destination and `CMD` in the Dockerfile, then rebuild.

- [ ] **Step 3: Run the container and verify it serves**

```bash
docker run --rm -p 4000:4000 waxseal-docs &
sleep 3
curl -s -o /dev/null -w "%{http_code}" http://localhost:4000
```

Expected: `200`.

Stop the container:

```bash
docker stop $(docker ps -q --filter ancestor=waxseal-docs)
```

- [ ] **Step 4: Commit**

```bash
git add apps/fumadocs/Dockerfile
git commit -m "feat: add multi-stage Docker docs server"
```

---

### Task 5: Root `docker-compose.yml`

**Files:**
- Create: `docker-compose.yml`

**Interfaces:**
- Consumes: `apps/extension/Dockerfile` (Task 3), `apps/fumadocs/Dockerfile` (Task 4)
- Produces: `docker compose up` → docs site at `http://localhost:4000`; `docker compose run --rm extension-builder` → extension artifacts in `./dist/`

- [ ] **Step 1: Create `docker-compose.yml` at the repo root**

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

- [ ] **Step 2: Build both services**

```bash
docker compose build
```

Expected: both `docs` and `extension-builder` build without errors.

- [ ] **Step 3: Verify the docs service starts and serves**

```bash
docker compose up docs -d
sleep 3
curl -s -o /dev/null -w "%{http_code}" http://localhost:4000
```

Expected: `200`.

```bash
docker compose down
```

- [ ] **Step 4: Verify the extension-builder exports artifacts**

```bash
docker compose run --rm extension-builder
ls dist/
```

Expected: `chrome-mv3/` directory in `./dist/`.

Confirm it contains the manifest:

```bash
cat dist/chrome-mv3/manifest.json | head -3
```

Expected: `{"manifest_version": 3, ...}` (valid JSON).

- [ ] **Step 5: Verify `docker compose up` (no args) does NOT start extension-builder**

```bash
docker compose up -d
docker compose ps
```

Expected: only `docs` shows as running (extension-builder has `tools` profile and is excluded by default).

```bash
docker compose down
```

- [ ] **Step 6: Commit**

```bash
git add docker-compose.yml
git commit -m "feat: add docker-compose for docs server and extension builder"
```
