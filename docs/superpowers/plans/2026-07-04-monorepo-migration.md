# Monorepo Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate waxseal from a pnpm workspace to a Bun + TurboRepo monorepo, adding `apps/extension` (WXT+React) and `apps/fumadocs` (Fumadocs docs site), while keeping `packages/crypto-core` intact.

**Architecture:** The root becomes a Turbo monorepo with bun workspaces; `packages/config` holds shared TypeScript config; `packages/crypto-core` gains turbo-compatible scripts; `apps/extension` replaces the old `chrome/` compiled-output approach with a proper WXT scaffold; `apps/fumadocs` is a Fumadocs Next.js app (scaffold only, no docs content). Biome replaces ESLint + Prettier throughout.

**Tech Stack:** Bun (package manager + runtime), TurboRepo 2.x (task orchestration), Biome 2.x (lint + format), WXT 0.20+ (browser extension), React 19, Fumadocs 16, Next.js 16, Husky + lint-staged (git hooks), Vitest (crypto-core tests).

## Global Constraints

- Package manager: bun (`packageManager: "bun@1.2.20"`)
- All workspace packages use `workspace:*` for internal deps
- Lint/format: Biome only — no ESLint, no Prettier
- Turbo task names: `build`, `dev`, `check-types`, `test`, `lint`
- `apps/extension` must use WXT with `@wxt-dev/module-react`
- `apps/fumadocs` must be scaffold-only — no waxseal doc content added
- Internal shared package prefix: `@waxseal/*`
- Vitest stays for crypto-core (bun is the package manager, not the test runner)

---

## File Map

**Create:**
- `turbo.json`
- `biome.json`
- `bunfig.toml`
- `tsconfig.json`
- `.husky/pre-commit`
- `.agents/skills/turborepo/` (copied from my-better-t-app)
- `packages/config/package.json`
- `packages/config/tsconfig.base.json`
- `apps/extension/package.json`
- `apps/extension/wxt.config.ts`
- `apps/extension/tsconfig.json`
- `apps/extension/.gitignore`
- `apps/extension/entrypoints/background.ts`
- `apps/extension/entrypoints/content.ts`
- `apps/extension/entrypoints/popup/index.html`
- `apps/extension/entrypoints/popup/main.tsx`
- `apps/extension/entrypoints/popup/App.tsx`
- `apps/extension/entrypoints/popup/App.css`
- `apps/extension/entrypoints/popup/style.css`
- `apps/extension/assets/react.svg`
- `apps/extension/public/wxt.svg`
- `apps/extension/public/icon/{16,32,48,96,128}.png`
- `apps/fumadocs/` (full directory — see Task 5)

**Modify:**
- `package.json` (root) — replace pnpm config with bun/turbo/biome
- `.gitignore` — add turbo, dev-dist, .wxt, dev-dist, chrome/
- `packages/crypto-core/package.json` — add `check-types` script, add `@waxseal/config` devDep
- `packages/crypto-core/tsconfig.json` — extend `@waxseal/config/tsconfig.base.json`
- `.github/workflows/ci.yml` — replace pnpm actions with bun
- `README.md` — update dev commands and monorepo structure docs

**Delete:**
- `pnpm-workspace.yaml`
- `.eslintrc.cjs`
- `.prettierrc.json`

---

### Task 1: Root Monorepo Config (pnpm → bun + turbo + biome)

**Files:**
- Modify: `package.json`
- Create: `turbo.json`, `biome.json`, `bunfig.toml`, `tsconfig.json`
- Modify: `.gitignore`
- Delete: `pnpm-workspace.yaml`, `.eslintrc.cjs`, `.prettierrc.json`

**Interfaces:**
- Produces: root workspace that discovers `apps/*` and `packages/*` via bun workspaces; `turbo run build/test/check-types` as the canonical way to run tasks across the monorepo

- [ ] **Step 1: Replace root package.json**

```json
{
  "name": "waxseal",
  "private": true,
  "version": "0.0.0",
  "description": "End-to-end encryption overlay for web chat apps that don't support it natively.",
  "license": "MIT",
  "type": "module",
  "workspaces": [
    "apps/*",
    "packages/*"
  ],
  "scripts": {
    "dev": "turbo run dev",
    "build": "turbo run build",
    "check-types": "turbo run check-types",
    "test": "turbo run test",
    "check": "biome check --write .",
    "prepare": "husky"
  },
  "devDependencies": {
    "@biomejs/biome": "^2.5.2",
    "@types/node": "^22.13.14",
    "@waxseal/config": "workspace:*",
    "husky": "^9.1.7",
    "lint-staged": "^17.0.7",
    "turbo": "^2.10.2",
    "typescript": "^6"
  },
  "lint-staged": {
    "*.{js,ts,cjs,mjs,d.cts,d.mts,jsx,tsx,json,jsonc}": [
      "biome check --write ."
    ]
  },
  "packageManager": "bun@1.2.20"
}
```

- [ ] **Step 2: Create turbo.json**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "ui": "tui",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "inputs": ["$TURBO_DEFAULT$", ".env*"],
      "outputs": ["dist/**", ".next/**", ".output/**", "dev-dist/**"]
    },
    "lint": {
      "dependsOn": ["^lint"]
    },
    "check-types": {
      "dependsOn": ["^check-types"]
    },
    "test": {
      "dependsOn": ["^build"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    }
  }
}
```

- [ ] **Step 3: Create biome.json**

```json
{
  "$schema": "./node_modules/@biomejs/biome/configuration_schema.json",
  "vcs": {
    "enabled": false,
    "clientKind": "git",
    "useIgnoreFile": false
  },
  "files": {
    "ignoreUnknown": false,
    "includes": [
      "**",
      "!**/.next",
      "!**/dist",
      "!**/.turbo",
      "!**/dev-dist",
      "!**/.wxt",
      "!**/.zed",
      "!**/.vscode",
      "!**/routeTree.gen.ts",
      "!**/.source",
      "!**/bts.jsonc"
    ]
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "tab"
  },
  "assist": { "actions": { "source": { "organizeImports": "on" } } },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "correctness": {
        "useExhaustiveDependencies": "info"
      },
      "nursery": {
        "useSortedClasses": {
          "level": "warn",
          "fix": "safe",
          "options": {
            "functions": ["clsx", "cva", "cn"]
          }
        }
      },
      "style": {
        "noParameterAssign": "error",
        "useAsConstAssertion": "error",
        "useDefaultParameterLast": "error",
        "useEnumInitializers": "error",
        "useSelfClosingElements": "error",
        "useSingleVarDeclarator": "error",
        "noUnusedTemplateLiteral": "error",
        "useNumberNamespace": "error",
        "noInferrableTypes": "error",
        "noUselessElse": "error"
      }
    }
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "double"
    }
  },
  "css": {
    "parser": {
      "tailwindDirectives": true
    }
  }
}
```

- [ ] **Step 4: Create bunfig.toml**

```toml
[install]
linker = "isolated"
```

- [ ] **Step 5: Create root tsconfig.json**

```json
{
  "extends": "@waxseal/config/tsconfig.base.json"
}
```

- [ ] **Step 6: Update .gitignore**

Replace with:

```
# Dependencies
node_modules
.pnp
.pnp.js

# Build outputs
dist
build
dev-dist
.output
*.tsbuildinfo

# WXT generated
.wxt

# Old chrome build outputs
chrome/

# Turbo
.turbo

# Next.js
.next
.source

# Environment variables
.env
.env*.local

# IDEs and editors
.vscode/*
!.vscode/settings.json
!.vscode/tasks.json
!.vscode/launch.json
!.vscode/extensions.json
.idea
*.swp
*.swo
*~
.DS_Store

# Logs
logs
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*
lerna-debug.log*
pnpm-debug.log*

# Testing
coverage
.nyc_output

# Misc
*.tgz
.cache
tmp
temp
```

- [ ] **Step 7: Delete old pnpm/eslint/prettier files**

```bash
rm pnpm-workspace.yaml pnpm-lock.yaml .eslintrc.cjs .prettierrc.json
```

Expected: files removed, no errors (some may already not exist).

- [ ] **Step 8: Verify root setup looks correct**

```bash
ls turbo.json biome.json bunfig.toml tsconfig.json
```

Expected: all four files listed.

- [ ] **Step 9: Commit**

```bash
git add package.json turbo.json biome.json bunfig.toml tsconfig.json .gitignore
git rm --cached pnpm-workspace.yaml pnpm-lock.yaml .eslintrc.cjs .prettierrc.json 2>/dev/null || true
git commit -m "chore: migrate root to bun+turbo monorepo, replace eslint/prettier with biome"
```

---

### Task 2: Shared Config Package

**Files:**
- Create: `packages/config/package.json`
- Create: `packages/config/tsconfig.base.json`

**Interfaces:**
- Produces: `@waxseal/config` workspace package exposing `tsconfig.base.json`; consumed by root `tsconfig.json` and `packages/crypto-core/tsconfig.json`

- [ ] **Step 1: Create packages/config/package.json**

```json
{
  "name": "@waxseal/config",
  "version": "0.0.0",
  "private": true
}
```

- [ ] **Step 2: Create packages/config/tsconfig.base.json**

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ESNext"],
    "verbatimModuleSyntax": true,
    "strict": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "allowSyntheticDefaultImports": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true,
    "noUncheckedIndexedAccess": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "types": ["node"]
  }
}
```

- [ ] **Step 3: Verify package files exist**

```bash
ls packages/config/
```

Expected: `package.json  tsconfig.base.json`

- [ ] **Step 4: Commit**

```bash
git add packages/config/
git commit -m "chore: add @waxseal/config shared tsconfig package"
```

---

### Task 3: Update packages/crypto-core for Turbo

**Files:**
- Modify: `packages/crypto-core/package.json`
- Modify: `packages/crypto-core/tsconfig.json`

**Interfaces:**
- Consumes: `@waxseal/config` from Task 2
- Produces: crypto-core exposing `check-types` and `test` turbo tasks; tests still pass with vitest

- [ ] **Step 1: Update packages/crypto-core/package.json**

```json
{
  "name": "@waxseal/crypto-core",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "test": "vitest run",
    "check-types": "tsc --noEmit"
  },
  "devDependencies": {
    "@waxseal/config": "workspace:*",
    "typescript": "^6",
    "vitest": "^2.1.4"
  }
}
```

- [ ] **Step 2: Update packages/crypto-core/tsconfig.json**

```json
{
  "extends": "@waxseal/config/tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022", "WebWorker"],
    "outDir": "dist"
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Install deps and verify tests pass**

```bash
bun install
bun run test --filter @waxseal/crypto-core
```

Expected: all crypto-core tests pass (bytes, envelope, fingerprint, handshake, keys, session).

- [ ] **Step 4: Commit**

```bash
git add packages/crypto-core/package.json packages/crypto-core/tsconfig.json bun.lock
git commit -m "chore: update crypto-core for turbo (check-types script, extend @waxseal/config)"
```

---

### Task 4: Create apps/extension (WXT + React)

**Files:**
- Create: `apps/extension/package.json`
- Create: `apps/extension/wxt.config.ts`
- Create: `apps/extension/tsconfig.json`
- Create: `apps/extension/.gitignore`
- Create: `apps/extension/entrypoints/background.ts`
- Create: `apps/extension/entrypoints/content.ts`
- Create: `apps/extension/entrypoints/popup/index.html`
- Create: `apps/extension/entrypoints/popup/main.tsx`
- Create: `apps/extension/entrypoints/popup/App.tsx`
- Create: `apps/extension/entrypoints/popup/App.css`
- Create: `apps/extension/entrypoints/popup/style.css`
- Create: `apps/extension/assets/react.svg`
- Create: `apps/extension/public/wxt.svg`
- Copy: `apps/extension/public/icon/` (5 PNG files from my-better-t-app)

**Interfaces:**
- Produces: `extension` workspace app with `dev`, `build`, and `check-types` turbo tasks; WXT scaffold with React popup, background script, content script

- [ ] **Step 1: Create apps/extension/package.json**

```json
{
  "name": "extension",
  "version": "0.0.0",
  "private": true,
  "description": "Waxseal browser extension — E2E encryption overlay for web chat apps",
  "type": "module",
  "scripts": {
    "dev": "wxt --port 5555",
    "dev:firefox": "wxt -b firefox",
    "build": "wxt build",
    "build:firefox": "wxt build -b firefox",
    "zip": "wxt zip",
    "zip:firefox": "wxt zip -b firefox",
    "check-types": "tsc --noEmit",
    "postinstall": "wxt prepare"
  },
  "dependencies": {
    "react": "^19.2.4",
    "react-dom": "^19.2.4"
  },
  "devDependencies": {
    "@types/react": "^19.2.14",
    "@types/react-dom": "^19.2.3",
    "@wxt-dev/module-react": "^1.1.5",
    "typescript": "^5.9.3",
    "wxt": "^0.20.27"
  }
}
```

- [ ] **Step 2: Create apps/extension/wxt.config.ts**

```typescript
import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
});
```

- [ ] **Step 3: Create apps/extension/tsconfig.json**

```json
{
  "extends": "./.wxt/tsconfig.json",
  "compilerOptions": {
    "allowImportingTsExtensions": true,
    "jsx": "react-jsx"
  }
}
```

- [ ] **Step 4: Create apps/extension/.gitignore**

```
logs
*.log
npm-debug.log*
yarn-debug.log*
pnpm-debug.log*
lerna-debug.log*

node_modules
.output
dev-dist
stats.html
stats-*.json
.wxt
web-ext.config.ts

.vscode/*
!.vscode/extensions.json
.idea
.DS_Store
*.suo
*.ntvs*
*.njsproj
*.sln
*.sw?
```

- [ ] **Step 5: Create apps/extension/entrypoints/background.ts**

```typescript
export default defineBackground(() => {
  console.log("Waxseal background running", { id: browser.runtime.id });
});
```

- [ ] **Step 6: Create apps/extension/entrypoints/content.ts**

```typescript
export default defineContentScript({
  matches: ["<all_urls>"],
  main() {
    console.log("Waxseal content script injected.");
  },
});
```

- [ ] **Step 7: Create apps/extension/entrypoints/popup/index.html**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Waxseal</title>
    <meta name="manifest.type" content="browser_action" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 8: Create apps/extension/entrypoints/popup/main.tsx**

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import "./style.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 9: Create apps/extension/entrypoints/popup/App.tsx**

```tsx
import wxtLogo from "/wxt.svg";
import { useState } from "react";
import reactLogo from "@/assets/react.svg";
import "./App.css";

function App() {
  const [count, setCount] = useState(0);

  return (
    <>
      <div>
        <a href="https://wxt.dev" target="_blank" rel="noreferrer">
          <img src={wxtLogo} className="logo" alt="WXT logo" />
        </a>
        <a href="https://react.dev" target="_blank" rel="noreferrer">
          <img src={reactLogo} className="logo react" alt="React logo" />
        </a>
      </div>
      <h1>Waxseal</h1>
      <div className="card">
        <button onClick={() => setCount((count) => count + 1)}>
          count is {count}
        </button>
        <p>
          Edit <code>entrypoints/popup/App.tsx</code> and save to test HMR
        </p>
      </div>
    </>
  );
}

export default App;
```

- [ ] **Step 10: Create apps/extension/entrypoints/popup/App.css**

```css
#root {
  max-width: 1280px;
  margin: 0 auto;
  padding: 2rem;
  text-align: center;
}

.logo {
  height: 6em;
  padding: 1.5em;
  will-change: filter;
  transition: filter 300ms;
}
.logo:hover {
  filter: drop-shadow(0 0 2em #54bc4ae0);
}
.logo.react:hover {
  filter: drop-shadow(0 0 2em #61dafbaa);
}

@keyframes logo-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: no-preference) {
  a:nth-of-type(2) .logo {
    animation: logo-spin infinite 20s linear;
  }
}

.card {
  padding: 2em;
}

.read-the-docs {
  color: #888;
}
```

- [ ] **Step 11: Create apps/extension/entrypoints/popup/style.css**

```css
:root {
  font-family: Inter, system-ui, Avenir, Helvetica, Arial, sans-serif;
  line-height: 1.5;
  font-weight: 400;
  color-scheme: light dark;
  color: rgba(255, 255, 255, 0.87);
  background-color: #242424;
  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

a {
  font-weight: 500;
  color: #646cff;
  text-decoration: inherit;
}
a:hover {
  color: #535bf2;
}

body {
  margin: 0;
  display: flex;
  place-items: center;
  min-width: 320px;
  min-height: 100vh;
}

h1 {
  font-size: 3.2em;
  line-height: 1.1;
}

button {
  border-radius: 8px;
  border: 1px solid transparent;
  padding: 0.6em 1.2em;
  font-size: 1em;
  font-weight: 500;
  font-family: inherit;
  background-color: #1a1a1a;
  cursor: pointer;
  transition: border-color 0.25s;
}
button:hover {
  border-color: #646cff;
}
button:focus,
button:focus-visible {
  outline: 4px auto -webkit-focus-ring-color;
}

@media (prefers-color-scheme: light) {
  :root {
    color: #213547;
    background-color: #ffffff;
  }
  a:hover {
    color: #747bff;
  }
  button {
    background-color: #f9f9f9;
  }
}
```

- [ ] **Step 12: Copy SVG assets from my-better-t-app/apps/extension**

```bash
cp my-better-t-app/apps/extension/assets/react.svg apps/extension/assets/react.svg
cp my-better-t-app/apps/extension/public/wxt.svg apps/extension/public/wxt.svg
mkdir -p apps/extension/public/icon
cp my-better-t-app/apps/extension/public/icon/16.png apps/extension/public/icon/16.png
cp my-better-t-app/apps/extension/public/icon/32.png apps/extension/public/icon/32.png
cp my-better-t-app/apps/extension/public/icon/48.png apps/extension/public/icon/48.png
cp my-better-t-app/apps/extension/public/icon/96.png apps/extension/public/icon/96.png
cp my-better-t-app/apps/extension/public/icon/128.png apps/extension/public/icon/128.png
```

Expected: no errors.

- [ ] **Step 13: Install deps and verify extension builds**

```bash
bun install
cd apps/extension && bun run build
```

Expected: WXT builds the extension to `.output/chrome-mv3/` without TypeScript errors.

- [ ] **Step 14: Commit**

```bash
git add apps/extension/
git commit -m "feat: add WXT+React browser extension app scaffold"
```

---

### Task 5: Create apps/fumadocs

**Files:**
- Create: all files under `apps/fumadocs/` (adapted from my-better-t-app/apps/fumadocs)

**Interfaces:**
- Produces: `fumadocs` workspace app with `build`, `dev`, and `check-types` turbo tasks; Next.js 16 + Fumadocs 16 docs site scaffold with `appName = "Waxseal"` and correct GitHub config

- [ ] **Step 1: Copy fumadocs app structure from template**

```bash
cp -r my-better-t-app/apps/fumadocs apps/fumadocs
```

Expected: `apps/fumadocs/` directory exists with all source files.

- [ ] **Step 2: Update apps/fumadocs/package.json**

Replace `"name": "fumadocs"` stays but add `check-types` to scripts (already present as `types:check` — rename it):

Full replacement:

```json
{
  "name": "fumadocs",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "build": "next build",
    "dev": "next dev --port=4000",
    "start": "next start",
    "check-types": "fumadocs-mdx && next typegen && tsc --noEmit",
    "postinstall": "fumadocs-mdx",
    "lint": "biome check",
    "format": "biome format --write"
  },
  "dependencies": {
    "@takumi-rs/image-response": "^1.8.7",
    "cnfast": "^0.0.8",
    "fumadocs-core": "16.10.7",
    "fumadocs-mdx": "15.0.13",
    "fumadocs-ui": "16.10.7",
    "lucide-react": "^1.21.0",
    "next": "16.2.9",
    "react": "^19.2.7",
    "react-dom": "^19.2.7"
  },
  "devDependencies": {
    "@biomejs/biome": "^2.5.1",
    "@tailwindcss/postcss": "^4.3.1",
    "@types/mdx": "^2.0.14",
    "@types/node": "^26.0.0",
    "@types/react": "^19.2.17",
    "@types/react-dom": "^19.2.3",
    "postcss": "^8.5.15",
    "tailwindcss": "^4.3.1",
    "typescript": "^6.0.3"
  }
}
```

- [ ] **Step 3: Update apps/fumadocs/src/lib/shared.ts — change app name and git config**

```typescript
export const appName = "Waxseal";
export const docsRoute = "/docs";
export const docsImageRoute = "/og/docs";
export const docsContentRoute = "/llms.mdx/docs";

export const gitConfig = {
  user: "AliSohani2082",
  repo: "waxseal",
  branch: "main",
};
```

- [ ] **Step 4: Install deps**

```bash
bun install
```

Expected: fumadocs deps installed, no errors.

- [ ] **Step 5: Verify fumadocs builds**

```bash
cd apps/fumadocs && bun run build
```

Expected: Next.js build succeeds. (May take 30–60 seconds.)

- [ ] **Step 6: Commit**

```bash
git add apps/fumadocs/
git commit -m "feat: add Fumadocs app scaffold (Waxseal branding, no doc content)"
```

---

### Task 6: Husky, Lint-staged, and .agents Skills

**Files:**
- Create: `.husky/pre-commit`
- Copy: `.agents/skills/turborepo/` from my-better-t-app

**Interfaces:**
- Produces: pre-commit hook that runs `lint-staged` (biome check on staged files); turborepo skill available to AI agents

- [ ] **Step 1: Initialize husky**

```bash
bun run prepare
```

Expected: `.husky/` directory initialized (or already exists).

- [ ] **Step 2: Create .husky/pre-commit**

```bash
lint-staged
```

(This is the full file content — one line, no shebang needed for modern husky.)

- [ ] **Step 3: Copy turborepo skill and skills-lock from my-better-t-app**

```bash
cp -r my-better-t-app/.agents .agents
cp my-better-t-app/skills-lock.json skills-lock.json
```

Expected: `.agents/skills/turborepo/` exists at repo root, `skills-lock.json` exists.

- [ ] **Step 4: Verify hook file is executable**

```bash
chmod +x .husky/pre-commit
ls -la .husky/pre-commit
```

Expected: file has execute permission.

- [ ] **Step 5: Commit**

```bash
git add .husky/ .agents/
git commit -m "chore: add husky pre-commit hook and turborepo AI skill"
```

---

### Task 7: Update GitHub CI Workflow

**Files:**
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: bun workspace from Task 1
- Produces: CI that installs with bun, runs `bun run check-types`, `bun run test`, `bun run build`

- [ ] **Step 1: Replace .github/workflows/ci.yml**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest
      - run: bun install --frozen-lockfile
      - run: bun run check-types
      - run: bun run test
      - run: bun run build
```

- [ ] **Step 2: Verify YAML syntax**

```bash
cat .github/workflows/ci.yml
```

Expected: file displays correctly, no syntax errors visible.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: migrate from pnpm to bun, update workflow for turbo monorepo"
```

---

### Task 8: Update README and Docs

**Files:**
- Modify: `README.md`

**Interfaces:**
- Produces: README reflecting the new monorepo structure, bun commands, and package descriptions

- [ ] **Step 1: Replace README.md**

```markdown
# waxseal

A Chrome/Firefox extension that layers end-to-end encryption on top of web
chat apps that don't support it natively. Two consenting users install the
extension; outgoing text is intercepted and encrypted before it reaches the
site's own send handler, flows through the site as an opaque blob, and is
decrypted and swapped back into the DOM on the receiving end.

Status: **early proof of concept, pre-alpha**.

## Repository Structure

This is a Bun + TurboRepo monorepo.

```
apps/
  extension/    # WXT + React browser extension (Chrome/Firefox)
  fumadocs/     # Documentation site (Next.js + Fumadocs)
packages/
  config/       # Shared TypeScript config (@waxseal/config)
  crypto-core/  # Identity keys, handshake, envelope encoding, session encryption
docs/
  CRYPTO_DESIGN.md   # Cryptographic design (read this first)
  WIRE_FORMAT.md     # Terse wire-format reference
  ADAPTER_GUIDE.md   # How to add support for a new site
  SYNC_DESIGN.md     # Multi-device sync design
```

## Development

```sh
bun install

# Run all dev servers (extension + docs)
bun run dev

# Run all tests
bun run test

# Type-check all packages
bun run check-types

# Build everything
bun run build

# Extension only
cd apps/extension
bun run build          # Chrome (Manifest V3)
bun run build:firefox  # Firefox
bun run dev            # Dev mode with HMR

# Docs only
cd apps/fumadocs
bun run dev            # localhost:4000
```

## Cryptography

- `docs/CRYPTO_DESIGN.md` — full cryptographic design (read this first).
- `docs/WIRE_FORMAT.md` — terse wire-format reference.
- `docs/ADAPTER_GUIDE.md` — how to add support for a new site.
- `SECURITY.md` — threat model and vulnerability reporting.

## License

MIT — see `LICENSE`.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: update README to reflect bun+turbo monorepo structure"
```

---

### Task 9: Final Verification

- [ ] **Step 1: Install all dependencies from scratch**

```bash
rm -rf node_modules apps/*/node_modules packages/*/node_modules
bun install
```

Expected: bun installs all workspaces, no errors.

- [ ] **Step 2: Run turbo type-check across all packages**

```bash
bun run check-types
```

Expected: all packages type-check clean (crypto-core, extension, fumadocs).

- [ ] **Step 3: Run crypto-core tests**

```bash
bun run test
```

Expected: all 6 crypto-core test suites pass.

- [ ] **Step 4: Verify extension builds**

```bash
bun run build --filter extension
```

Expected: WXT builds `.output/chrome-mv3/` without errors.

- [ ] **Step 5: Confirm workspace layout**

```bash
bun pm ls
```

Expected: lists `apps/extension`, `apps/fumadocs`, `packages/config`, `packages/crypto-core`.

- [ ] **Step 6: Ask user to review the migration**

Stop here and present the completed monorepo structure for user review before proceeding to remove `my-better-t-app/`.
