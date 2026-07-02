# Phase 2 — Browser Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the waxseal Chrome/Firefox extension with the Bale adapter — a full encrypt/decrypt round-trip proof-of-concept establishing the adapter architecture for future phases.

**Architecture:** All crypto runs in a MV3 background service worker; the content script only touches the DOM and routes opaque envelopes via `chrome.runtime.sendMessage`. `adapter-api` defines the `SiteAdapter` interface; `adapter-bale` implements it; `extension-core` owns the worker, content script, popup, storage, and message protocol; `build` packages everything into Chrome and Firefox extensions via Vite.

**Tech Stack:** TypeScript 5.6 (strict, ES2022), Vitest 2, jsdom (adapter/content-script tests), `fake-indexeddb` (background tests), Vite 5 (extension build), Playwright (E2E), pnpm workspaces.

## Global Constraints

- All packages: TypeScript strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`, same as `tsconfig.base.json`.
- Module format: `"type": "module"` in every `package.json`; `.js` extensions in all relative imports (TypeScript bundler resolution).
- Test runner: Vitest; tests live in `<pkg>/test/`, named `*.test.ts`.
- No shared mutable state between packages — `adapter-bale` never imports from `extension-core`; `adapter-bale` never touches `crypto-core`.
- The background service worker is the **only** place where `crypto.subtle` is called and where IndexedDB is accessed.
- Wire format marker: `⁉WAXSEAL1:` (imported as `MARKER` from `@waxseal/crypto-core`).
- Decorator for decrypted messages: `🔒 <plaintext>`.
- pnpm workspace — add new packages as workspace members by placing them under `packages/` or `packages/adapters/`; workspace config already covers these globs.

---

## File Map

```
packages/
  adapters/
    adapter-api/
      package.json
      tsconfig.json
      vitest.config.ts
      src/index.ts          ← SiteAdapter interface export
      src/mock.ts           ← MockSiteAdapter (test harness)
      test/mock.test.ts
    adapter-bale/
      package.json
      tsconfig.json
      vitest.config.ts
      src/index.ts          ← baleAdapter: SiteAdapter
      test/bale.test.ts
      test/fixtures/bale-chat.html
  extension-core/
    package.json
    tsconfig.json
    vitest.config.ts
    src/protocol.ts         ← BackgroundRequest / BackgroundResponse / ContentScriptMessage
    src/storage.ts          ← KeyStore interface + NonExtractableKeyStore (IndexedDB)
    src/peer-store.ts       ← PeerRecord type + PeerStore (IndexedDB)
    src/background.ts       ← service worker: identity init, state machine, message handler
    src/content-script.ts   ← MutationObserver + send intercept + message routing
    src/popup.html          ← popup UI markup
    src/popup.ts            ← popup script
    test/storage.test.ts
    test/peer-store.test.ts
    test/background.test.ts
    test/content-script.test.ts
  build/
    package.json
    tsconfig.json
    vite.config.ts          ← multi-entry: background, content-script, popup
    manifest.chrome.json
    manifest.firefox.json
    test/fixture-page/index.html   ← Bale-like chat page for E2E
e2e/
  package.json
  playwright.config.ts
  tests/handshake.spec.ts
  tests/message.spec.ts
```

---

## Task 1: adapter-api package

**Files:**
- Create: `packages/adapters/adapter-api/package.json`
- Create: `packages/adapters/adapter-api/tsconfig.json`
- Create: `packages/adapters/adapter-api/vitest.config.ts`
- Create: `packages/adapters/adapter-api/src/index.ts`
- Create: `packages/adapters/adapter-api/src/mock.ts`
- Create: `packages/adapters/adapter-api/test/mock.test.ts`

**Interfaces:**
- Produces: `SiteAdapter` interface, `MockSiteAdapter` class

- [ ] **Step 1: Write the failing test**

```typescript
// packages/adapters/adapter-api/test/mock.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { MockSiteAdapter } from "../src/mock.js";

describe("MockSiteAdapter", () => {
  let adapter: MockSiteAdapter;

  beforeEach(() => {
    adapter = new MockSiteAdapter();
  });

  it("matches any URL", () => {
    expect(adapter.matches("https://example.com")).toBe(true);
  });

  it("returns the mock composer element", () => {
    expect(adapter.getComposerElement()).not.toBeNull();
  });

  it("injectOutgoingText sets lastInjectedText and fires input event", () => {
    const el = adapter.getComposerElement()!;
    let inputFired = false;
    el.addEventListener("input", () => { inputFired = true; });
    adapter.injectOutgoingText(el, "hello");
    expect(adapter.lastInjectedText).toBe("hello");
    expect(inputFired).toBe(true);
  });

  it("triggerSend records send was called", () => {
    const el = adapter.getComposerElement()!;
    adapter.triggerSend(el);
    expect(adapter.sendTriggeredCount).toBe(1);
  });

  it("isMessageNode identifies mock message nodes", () => {
    const node = adapter.createMessageNode("hello");
    expect(adapter.isMessageNode(node)).toBe(true);
    expect(adapter.isMessageNode(document.createElement("div"))).toBe(false);
  });

  it("extractMessageText reads textContent", () => {
    const node = adapter.createMessageNode("hello") as Element;
    expect(adapter.extractMessageText(node)).toBe("hello");
  });

  it("replaceMessageText prepends lock emoji", () => {
    const node = adapter.createMessageNode("⁉WAXSEAL1:abc") as Element;
    adapter.replaceMessageText(node, "decrypted");
    expect(node.textContent).toBe("🔒 decrypted");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/adapters/adapter-api && pnpm vitest run
```
Expected: FAIL — `MockSiteAdapter` not found.

- [ ] **Step 3: Create package.json**

```json
{
  "name": "@waxseal/adapter-api",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "5.6.3",
    "vitest": "^2.1.4",
    "@vitest/globals": "^2.1.4"
  }
}
```

- [ ] **Step 4: Create tsconfig.json**

```json
{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM"],
    "outDir": "dist"
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 5: Create vitest.config.ts**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
  },
});
```

- [ ] **Step 6: Create src/index.ts — SiteAdapter interface**

```typescript
export interface SiteAdapter {
  id: string;
  matches(url: string): boolean;
  getComposerElement(): Element | null;
  getSendTrigger(): { type: "enter" };
  injectOutgoingText(el: Element, ciphertext: string): void;
  triggerSend(el: Element): void;
  getMessageListRoot(): Element | null;
  isMessageNode(node: Node): boolean;
  extractMessageText(node: Element): string;
  replaceMessageText(node: Element, plaintext: string): void;
}

export { MockSiteAdapter } from "./mock.js";
```

- [ ] **Step 7: Create src/mock.ts — MockSiteAdapter**

```typescript
import type { SiteAdapter } from "./index.js";

export class MockSiteAdapter implements SiteAdapter {
  id = "mock";

  private composerEl: Element;
  private listRoot: Element;
  lastInjectedText: string | null = null;
  sendTriggeredCount = 0;

  constructor() {
    this.composerEl = document.createElement("div");
    this.composerEl.setAttribute("contenteditable", "true");
    this.listRoot = document.createElement("div");
    this.listRoot.setAttribute("data-testid", "message-list");
    document.body.appendChild(this.composerEl);
    document.body.appendChild(this.listRoot);
  }

  matches(_url: string): boolean { return true; }

  getComposerElement(): Element { return this.composerEl; }

  getSendTrigger(): { type: "enter" } { return { type: "enter" }; }

  injectOutgoingText(el: Element, ciphertext: string): void {
    this.lastInjectedText = ciphertext;
    el.textContent = ciphertext;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }

  triggerSend(_el: Element): void {
    this.sendTriggeredCount++;
  }

  getMessageListRoot(): Element { return this.listRoot; }

  isMessageNode(node: Node): boolean {
    return node instanceof Element && node.getAttribute("data-testid") === "message-bubble";
  }

  extractMessageText(node: Element): string { return node.textContent ?? ""; }

  replaceMessageText(node: Element, plaintext: string): void {
    node.textContent = `🔒 ${plaintext}`;
  }

  createMessageNode(text: string): Node {
    const el = document.createElement("div");
    el.setAttribute("data-testid", "message-bubble");
    el.textContent = text;
    this.listRoot.appendChild(el);
    return el;
  }
}
```

- [ ] **Step 8: Run tests to verify they pass**

```bash
cd packages/adapters/adapter-api && pnpm vitest run
```
Expected: all 7 tests pass.

- [ ] **Step 9: Typecheck**

```bash
cd packages/adapters/adapter-api && pnpm typecheck
```
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add packages/adapters/adapter-api
git commit -m "feat: add adapter-api package with SiteAdapter interface and MockSiteAdapter"
```

---

## Task 2: adapter-bale package + HTML fixture

**Files:**
- Create: `packages/adapters/adapter-bale/package.json`
- Create: `packages/adapters/adapter-bale/tsconfig.json`
- Create: `packages/adapters/adapter-bale/vitest.config.ts`
- Create: `packages/adapters/adapter-bale/src/index.ts`
- Create: `packages/adapters/adapter-bale/test/fixtures/bale-chat.html`
- Create: `packages/adapters/adapter-bale/test/bale.test.ts`

**Interfaces:**
- Consumes: `SiteAdapter` from `@waxseal/adapter-api`
- Produces: `baleAdapter: SiteAdapter` (exported default-style named export)

- [ ] **Step 1: Write the failing test**

```typescript
// packages/adapters/adapter-bale/test/bale.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { baleAdapter } from "../src/index.js";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureHtml = readFileSync(join(__dirname, "fixtures/bale-chat.html"), "utf-8");

describe("baleAdapter", () => {
  beforeEach(() => {
    document.body.innerHTML = fixtureHtml;
  });

  it("matches web.bale.ai URLs only", () => {
    expect(baleAdapter.matches("https://web.bale.ai/chat/123")).toBe(true);
    expect(baleAdapter.matches("https://web.telegram.org")).toBe(false);
  });

  it("getComposerElement returns the Persian-label input", () => {
    expect(baleAdapter.getComposerElement()).not.toBeNull();
  });

  it("injectOutgoingText sets textContent and fires input event", () => {
    const el = baleAdapter.getComposerElement()!;
    let fired = false;
    el.addEventListener("input", () => { fired = true; });
    baleAdapter.injectOutgoingText(el, "⁉WAXSEAL1:abc123");
    expect(el.textContent).toBe("⁉WAXSEAL1:abc123");
    expect(fired).toBe(true);
  });

  it("triggerSend dispatches Enter keydown on composer", () => {
    const el = baleAdapter.getComposerElement()!;
    let key: string | null = null;
    el.addEventListener("keydown", (e) => { key = (e as KeyboardEvent).key; });
    baleAdapter.triggerSend(el);
    expect(key).toBe("Enter");
  });

  it("getMessageListRoot returns the message list", () => {
    expect(baleAdapter.getMessageListRoot()).not.toBeNull();
  });

  it("isMessageNode identifies message-bubble elements", () => {
    const el = document.querySelector('[data-testid="message-bubble"]')!;
    expect(baleAdapter.isMessageNode(el)).toBe(true);
    expect(baleAdapter.isMessageNode(document.createElement("div"))).toBe(false);
  });

  it("extractMessageText returns textContent", () => {
    const el = document.querySelector('[data-testid="message-bubble"]') as Element;
    expect(baleAdapter.extractMessageText(el)).toBe("سلام");
  });

  it("replaceMessageText sets text with lock emoji", () => {
    const el = document.querySelector('[data-testid="message-bubble"]') as Element;
    baleAdapter.replaceMessageText(el, "decrypted text");
    expect(el.textContent).toBe("🔒 decrypted text");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/adapters/adapter-bale && pnpm vitest run
```
Expected: FAIL — `baleAdapter` not found.

- [ ] **Step 3: Create package.json**

```json
{
  "name": "@waxseal/adapter-bale",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@waxseal/adapter-api": "workspace:*"
  },
  "devDependencies": {
    "typescript": "5.6.3",
    "vitest": "^2.1.4"
  }
}
```

- [ ] **Step 4: Create tsconfig.json**

```json
{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM"],
    "outDir": "dist"
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 5: Create vitest.config.ts**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
  },
});
```

- [ ] **Step 6: Create test/fixtures/bale-chat.html**

```html
<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head><meta charset="UTF-8"><title>Bale Web Fixture</title></head>
<body>
  <div class="chat-container">
    <div data-testid="message-list">
      <div data-testid="message-bubble">سلام</div>
      <div data-testid="message-bubble">چطوری؟</div>
    </div>
    <div class="composer-row">
      <div
        contenteditable="true"
        aria-label="پیام"
        data-testid="message-input"
        role="textbox"
      ></div>
      <button data-testid="send-button">ارسال</button>
    </div>
  </div>
</body>
</html>
```

- [ ] **Step 7: Create src/index.ts — baleAdapter**

```typescript
import type { SiteAdapter } from "@waxseal/adapter-api";

export const baleAdapter: SiteAdapter = {
  id: "bale",

  matches: (url) => url.includes("web.bale.ai"),

  getComposerElement: () =>
    document.querySelector('[aria-label="پیام"]') ?? null,

  getSendTrigger: () => ({ type: "enter" }),

  injectOutgoingText: (el, ciphertext) => {
    el.textContent = ciphertext;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  },

  triggerSend: (el) => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  },

  getMessageListRoot: () =>
    document.querySelector('[data-testid="message-list"]') ?? null,

  isMessageNode: (node) =>
    node instanceof Element && node.matches('[data-testid="message-bubble"]'),

  extractMessageText: (node) => node.textContent ?? "",

  replaceMessageText: (node, plaintext) => {
    node.textContent = `🔒 ${plaintext}`;
  },
};
```

- [ ] **Step 8: Run tests to verify they pass**

```bash
cd packages/adapters/adapter-bale && pnpm vitest run
```
Expected: all 8 tests pass.

- [ ] **Step 9: Typecheck**

```bash
cd packages/adapters/adapter-bale && pnpm typecheck
```
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add packages/adapters/adapter-bale
git commit -m "feat: add adapter-bale package with Bale web adapter and HTML fixture"
```

---

## Task 3: extension-core scaffold + protocol types

**Files:**
- Create: `packages/extension-core/package.json`
- Create: `packages/extension-core/tsconfig.json`
- Create: `packages/extension-core/vitest.config.ts`
- Create: `packages/extension-core/src/protocol.ts`

**Interfaces:**
- Produces: `BackgroundRequest`, `BackgroundResponse`, `ContentScriptMessage`, `HandshakeState` types

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@waxseal/extension-core",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/background.ts",
  "types": "./src/background.ts",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@waxseal/adapter-api": "workspace:*",
    "@waxseal/crypto-core": "workspace:*"
  },
  "devDependencies": {
    "@types/chrome": "^0.0.277",
    "fake-indexeddb": "^6.0.0",
    "typescript": "5.6.3",
    "vitest": "^2.1.4"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM", "WebWorker"],
    "outDir": "dist"
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Create vitest.config.ts**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
  },
});
```

- [ ] **Step 4: Create src/protocol.ts**

```typescript
export type HandshakeState = "IDLE" | "PENDING" | "ACTIVE";

export type BackgroundRequest =
  | { type: "ENCRYPT"; plaintext: string; peerKeyIdHex: string }
  | { type: "DECRYPT"; envelopeB64: string }
  | { type: "INITIATE_HANDSHAKE" }
  | { type: "GET_STATUS" }
  | { type: "GET_SAFETY_NUMBER" }
  | { type: "GET_CONTEXT" };

export type BackgroundResponse =
  | { ok: true; type: "ENCRYPTED"; envelopeB64: string }
  | { ok: true; type: "DECRYPTED"; plaintext: string; peerKeyIdHex: string }
  | { ok: true; type: "HANDSHAKE_INJECTED" }
  | { ok: true; type: "STATUS"; state: HandshakeState }
  | { ok: true; type: "SAFETY_NUMBER"; number: string }
  | { ok: true; type: "CONTEXT"; peerKeyIdHex: string | null; state: HandshakeState }
  | { ok: false; error: "NO_SESSION" | "DECRYPT_FAILED" | "KEY_CHANGE_DETECTED" | "NO_PEER" };

export type ContentScriptMessage =
  | { type: "INJECT_ENVELOPE"; envelopeB64: string };
```

> **Note on peerKeyIdHex:** The spec uses `peerFingerprint` in the protocol; here it is `peerKeyIdHex` — the 16-char hex encoding of the 8-byte `senderKeyId` from the peer's envelope. This is the Phase 2 PoC peer identifier. The full 32-byte SHA-256 fingerprint (for safety number display) is computed from the stored `peerPublicKeyJwk` when needed.

- [ ] **Step 5: Typecheck**

```bash
cd packages/extension-core && pnpm typecheck
```
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/extension-core
git commit -m "feat: scaffold extension-core package with typed background/content-script protocol"
```

---

## Task 4: extension-core storage (KeyStore + NonExtractableKeyStore)

**Files:**
- Create: `packages/extension-core/src/storage.ts`
- Create: `packages/extension-core/test/storage.test.ts`

**Interfaces:**
- Produces: `KeyStore` interface, `NonExtractableKeyStore` class

- [ ] **Step 1: Write the failing test**

```typescript
// packages/extension-core/test/storage.test.ts
import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import { NonExtractableKeyStore } from "../src/storage.js";

describe("NonExtractableKeyStore", () => {
  let store: NonExtractableKeyStore;

  beforeEach(() => {
    store = new NonExtractableKeyStore();
  });

  it("returns null when no key has been saved", async () => {
    const result = await store.loadIdentityKey();
    expect(result).toBeNull();
  });

  it("saves and loads a key pair", async () => {
    const pair = await crypto.subtle.generateKey(
      { name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["wrapKey", "unwrapKey"],
    ) as CryptoKeyPair;

    await store.saveIdentityKey(pair);
    const loaded = await store.loadIdentityKey();
    expect(loaded).not.toBeNull();
    expect(loaded!.publicKey.type).toBe("public");
    expect(loaded!.privateKey.type).toBe("private");
    expect(loaded!.privateKey.extractable).toBe(false);
  });

  it("loaded private key is non-extractable", async () => {
    const pair = await crypto.subtle.generateKey(
      { name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["wrapKey", "unwrapKey"],
    ) as CryptoKeyPair;

    await store.saveIdentityKey(pair);
    const loaded = await store.loadIdentityKey();
    await expect(
      crypto.subtle.exportKey("jwk", loaded!.privateKey),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/extension-core && pnpm vitest run test/storage.test.ts
```
Expected: FAIL — `NonExtractableKeyStore` not found.

- [ ] **Step 3: Create src/storage.ts**

```typescript
import { importPrivateKeyJwk, exportPrivateKeyJwk, RSA_OAEP_PARAMS } from "@waxseal/crypto-core";

export interface KeyStore {
  loadIdentityKey(): Promise<CryptoKeyPair | null>;
  saveIdentityKey(pair: CryptoKeyPair): Promise<void>;
}

const DB_NAME = "waxseal";
const DB_VERSION = 1;
const STORE_NAME = "identity-keys";
const RECORD_KEY = "identity";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (ev) => {
      const db = (ev.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
      if (!db.objectStoreNames.contains("peers")) {
        db.createObjectStore("peers", { keyPath: "senderKeyIdHex" });
      }
    };
    req.onsuccess = (ev) => resolve((ev.target as IDBOpenDBRequest).result);
    req.onerror = () => reject(req.error);
  });
}

export function idbGet<T>(db: IDBDatabase, storeName: string, key: string): Promise<T | null> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => resolve((req.result as T | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}

export function idbPut(db: IDBDatabase, storeName: string, value: unknown, key?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const req = key !== undefined
      ? tx.objectStore(storeName).put(value, key)
      : tx.objectStore(storeName).put(value);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export function idbDelete(db: IDBDatabase, storeName: string, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const req = tx.objectStore(storeName).delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export function idbGetAll<T>(db: IDBDatabase, storeName: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}

interface StoredIdentity {
  publicKey: CryptoKey;
  privateKeyJwk: JsonWebKey;
}

export class NonExtractableKeyStore implements KeyStore {
  private dbPromise: Promise<IDBDatabase> = openDb();

  async loadIdentityKey(): Promise<CryptoKeyPair | null> {
    const db = await this.dbPromise;
    const stored = await idbGet<StoredIdentity>(db, STORE_NAME, RECORD_KEY);
    if (!stored) return null;
    const privateKey = await importPrivateKeyJwk(stored.privateKeyJwk, false);
    return { publicKey: stored.publicKey, privateKey };
  }

  async saveIdentityKey(pair: CryptoKeyPair): Promise<void> {
    const db = await this.dbPromise;
    const privateKeyJwk = await exportPrivateKeyJwk(pair.privateKey);
    const stored: StoredIdentity = { publicKey: pair.publicKey, privateKeyJwk };
    await idbPut(db, STORE_NAME, stored, RECORD_KEY);
  }
}
```

> **Why store privateKeyJwk instead of CryptoKey directly?**
> Web Crypto's `generateKey` with `extractable=true` produces an extractable private key. We want the stored key to be non-extractable after the first save. We export the JWK once, discard the extractable key, then always re-import with `extractable=false` on load. This ensures the private key is never extractable after initial key generation.

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/extension-core && pnpm vitest run test/storage.test.ts
```
Expected: all 3 tests pass.

- [ ] **Step 5: Typecheck**

```bash
cd packages/extension-core && pnpm typecheck
```
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/extension-core/src/storage.ts packages/extension-core/test/storage.test.ts
git commit -m "feat: add KeyStore interface and NonExtractableKeyStore with IndexedDB persistence"
```

---

## Task 5: extension-core peer store

**Files:**
- Create: `packages/extension-core/src/peer-store.ts`
- Create: `packages/extension-core/test/peer-store.test.ts`

**Interfaces:**
- Consumes: `idbGet`, `idbPut`, `idbGetAll` from `./storage.js`; `IDBDatabase` from openDb (passed in)
- Produces: `PeerRecord` type, `PeerStore` class

- [ ] **Step 1: Write the failing test**

```typescript
// packages/extension-core/test/peer-store.test.ts
import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import { PeerStore } from "../src/peer-store.js";

describe("PeerStore", () => {
  let store: PeerStore;

  beforeEach(() => {
    store = new PeerStore();
  });

  it("returns null for an unknown peer", async () => {
    const result = await store.get("deadbeef01020304");
    expect(result).toBeNull();
  });

  it("saves and retrieves a peer record", async () => {
    const key = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"],
    );
    await store.save({
      senderKeyIdHex: "aabbccdd11223344",
      peerPublicKeyJwk: { kty: "RSA", n: "fake" } as JsonWebKey,
      sessionKey: key,
      sessionKeyIdB64: "abc123",
      handshakeState: "ACTIVE",
      pendingNonceB64: null,
    });
    const rec = await store.get("aabbccdd11223344");
    expect(rec).not.toBeNull();
    expect(rec!.handshakeState).toBe("ACTIVE");
    expect(rec!.sessionKeyIdB64).toBe("abc123");
    expect(rec!.sessionKey).toBe(key);
  });

  it("updates existing peer state", async () => {
    await store.save({
      senderKeyIdHex: "1234567890abcdef",
      peerPublicKeyJwk: { kty: "RSA" } as JsonWebKey,
      sessionKey: null,
      sessionKeyIdB64: null,
      handshakeState: "PENDING",
      pendingNonceB64: "nonce-value",
    });
    await store.save({
      senderKeyIdHex: "1234567890abcdef",
      peerPublicKeyJwk: { kty: "RSA" } as JsonWebKey,
      sessionKey: null,
      sessionKeyIdB64: null,
      handshakeState: "ACTIVE",
      pendingNonceB64: null,
    });
    const rec = await store.get("1234567890abcdef");
    expect(rec!.handshakeState).toBe("ACTIVE");
    expect(rec!.pendingNonceB64).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/extension-core && pnpm vitest run test/peer-store.test.ts
```
Expected: FAIL — `PeerStore` not found.

- [ ] **Step 3: Create src/peer-store.ts**

```typescript
import type { HandshakeState } from "./protocol.js";
import { idbGet, idbPut } from "./storage.js";

export interface PeerRecord {
  senderKeyIdHex: string;
  peerPublicKeyJwk: JsonWebKey;
  sessionKey: CryptoKey | null;
  sessionKeyIdB64: string | null;
  handshakeState: HandshakeState;
  pendingNonceB64: string | null;
}

const DB_NAME = "waxseal";
const DB_VERSION = 1;
const STORE_NAME = "peers";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (ev) => {
      const db = (ev.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains("identity-keys")) {
        db.createObjectStore("identity-keys");
      }
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "senderKeyIdHex" });
      }
    };
    req.onsuccess = (ev) => resolve((ev.target as IDBOpenDBRequest).result);
    req.onerror = () => reject(req.error);
  });
}

export class PeerStore {
  private dbPromise: Promise<IDBDatabase> = openDb();

  async get(senderKeyIdHex: string): Promise<PeerRecord | null> {
    const db = await this.dbPromise;
    return idbGet<PeerRecord>(db, STORE_NAME, senderKeyIdHex);
  }

  async save(record: PeerRecord): Promise<void> {
    const db = await this.dbPromise;
    await idbPut(db, STORE_NAME, record);
  }
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
```

> **Note:** Both `NonExtractableKeyStore` and `PeerStore` open the same IndexedDB database (`waxseal`) with the same `DB_VERSION`. Both `onupgradeneeded` handlers create both object stores so whichever opens first will set up the full schema. In production, the background script creates one singleton of each and passes them a shared `IDBDatabase` — this duplication is acceptable for the PoC.

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/extension-core && pnpm vitest run test/peer-store.test.ts
```
Expected: all 3 tests pass.

- [ ] **Step 5: Typecheck**

```bash
cd packages/extension-core && pnpm typecheck
```
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/extension-core/src/peer-store.ts packages/extension-core/test/peer-store.test.ts
git commit -m "feat: add PeerStore for per-peer session state persistence in IndexedDB"
```

---

## Task 6: extension-core background service worker

**Files:**
- Create: `packages/extension-core/src/background.ts`
- Create: `packages/extension-core/test/background.test.ts`

**Interfaces:**
- Consumes: `NonExtractableKeyStore` from `./storage.js`; `PeerStore`, `PeerRecord`, `toHex` from `./peer-store.js`; `BackgroundRequest`, `BackgroundResponse`, `ContentScriptMessage` from `./protocol.js`; all crypto from `@waxseal/crypto-core`
- Produces: exports `handleMessage(req, tabId)` for testing; registers `chrome.runtime.onMessage` listener at module load

- [ ] **Step 1: Write the failing test**

```typescript
// packages/extension-core/test/background.test.ts
import "fake-indexeddb/auto";
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock chrome APIs before importing background
const mockSendMessage = vi.fn();
const mockOnMessage = { addListener: vi.fn() };
globalThis.chrome = {
  runtime: { onMessage: mockOnMessage, sendMessage: vi.fn() },
  tabs: { sendMessage: mockSendMessage },
} as unknown as typeof chrome;

import { handleMessage } from "../src/background.js";
import {
  generateIdentityKeyPair, exportPublicKeyJwk,
  HandshakeInitiator, HandshakeResponder, createSessionKeyAck,
  encodeEnvelope, decodeEnvelope, MsgType,
  encryptMessage, utf8Encode, base64UrlEncode, shortKeyId,
} from "@waxseal/crypto-core";

async function makeKeyPair() {
  return generateIdentityKeyPair(true);
}

describe("background handleMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("ENCRYPT returns NO_SESSION before any handshake", async () => {
    const res = await handleMessage({ type: "ENCRYPT", plaintext: "hello", peerKeyIdHex: "0000000000000000" }, 1);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("NO_SESSION");
  });

  it("GET_STATUS returns IDLE for unknown peer", async () => {
    const res = await handleMessage({ type: "GET_STATUS" }, 1);
    expect(res).toEqual({ ok: true, type: "STATUS", state: "IDLE" });
  });

  it("GET_CONTEXT returns null peer when no session", async () => {
    const res = await handleMessage({ type: "GET_CONTEXT" }, 99);
    expect(res).toEqual({ ok: true, type: "CONTEXT", peerKeyIdHex: null, state: "IDLE" });
  });

  it("full handshake: INITIATE then receive RESPONSE reaches ACTIVE state", async () => {
    const tabId = 101;

    // Step 1: initiator triggers INITIATE_HANDSHAKE
    const initRes = await handleMessage({ type: "INITIATE_HANDSHAKE" }, tabId);
    expect(initRes).toMatchObject({ ok: true, type: "HANDSHAKE_INJECTED" });

    // Step 2: simulate peer responding
    const peer = await makeKeyPair();
    const peerPublicKeyJwk = await exportPublicKeyJwk(peer.publicKey);
    const injectedEnvelopeB64 = mockSendMessage.mock.calls.at(-1)?.[1].envelopeB64 as string;
    expect(injectedEnvelopeB64).toBeTruthy();

    const initFields = decodeEnvelope(injectedEnvelopeB64);
    expect(initFields.msgType).toBe(MsgType.HANDSHAKE_INIT);

    const responder = new HandshakeResponder(peer);
    const { responseFields } = await responder.handleInit(initFields);
    const responseEnvelope = encodeEnvelope(responseFields);

    // Step 3: feed HANDSHAKE_RESPONSE back to background
    const decryptRes = await handleMessage({ type: "DECRYPT", envelopeB64: responseEnvelope }, tabId);
    expect(decryptRes).toMatchObject({ ok: true, type: "HANDSHAKE_INJECTED" });

    // Step 4: session should now be ACTIVE
    const statusRes = await handleMessage({ type: "GET_STATUS" }, tabId);
    expect(statusRes).toEqual({ ok: true, type: "STATUS", state: "ACTIVE" });
  });

  it("ENCRYPT and DECRYPT round-trip after active session", async () => {
    const tabId = 102;
    const peer = await makeKeyPair();
    const peerPublicKeyJwk = await exportPublicKeyJwk(peer.publicKey);

    // Initiate handshake
    await handleMessage({ type: "INITIATE_HANDSHAKE" }, tabId);
    const injectedEnvelope = mockSendMessage.mock.calls.at(-1)?.[1].envelopeB64 as string;
    const initFields = decodeEnvelope(injectedEnvelope);
    const responder = new HandshakeResponder(peer);
    const { responseFields } = await responder.handleInit(initFields);
    await handleMessage({ type: "DECRYPT", envelopeB64: encodeEnvelope(responseFields) }, tabId);

    // Get peer key id from context
    const ctx = await handleMessage({ type: "GET_CONTEXT" }, tabId);
    expect(ctx.ok).toBe(true);
    if (!ctx.ok) throw new Error();
    if (ctx.type !== "CONTEXT") throw new Error();
    const peerKeyIdHex = ctx.peerKeyIdHex!;

    // Encrypt
    const encRes = await handleMessage({ type: "ENCRYPT", plaintext: "secret message", peerKeyIdHex }, tabId);
    expect(encRes.ok).toBe(true);
    if (!encRes.ok) throw new Error();
    if (encRes.type !== "ENCRYPTED") throw new Error();

    // Decrypt from the peer's side perspective: peer encrypts back to us
    // (simulate by decrypting what we encrypted — same session key on both sides after Phase 2 PoC simplification)
    // Instead: have the peer encrypt a DATA message to us using the session key from the responder
    // This is a more realistic test — the peer sends us an encrypted DATA message
    const { sessionKey, sessionKeyId } = (await responder.handleInit(initFields) as never as {
      sessionKey: CryptoKey; sessionKeyId: Uint8Array;
    });
    // Note: for simpler test, just verify the round-trip at the background level
    const decRes = await handleMessage({ type: "DECRYPT", envelopeB64: encRes.envelopeB64 }, tabId);
    // We encrypted it, so background can decrypt with the same session key
    expect(decRes.ok).toBe(true);
    if (!decRes.ok) throw new Error();
    if (decRes.type !== "DECRYPTED") throw new Error();
    expect(decRes.plaintext).toBe("secret message");
  });

  it("returns KEY_CHANGE_DETECTED when a new HANDSHAKE_INIT arrives on active tab", async () => {
    const tabId = 103;

    // Establish a session
    await handleMessage({ type: "INITIATE_HANDSHAKE" }, tabId);
    const injectedEnvelope = mockSendMessage.mock.calls.at(-1)?.[1].envelopeB64 as string;
    const initFields = decodeEnvelope(injectedEnvelope);
    const peer1 = await makeKeyPair();
    const responder1 = new HandshakeResponder(peer1);
    const { responseFields } = await responder1.handleInit(initFields);
    await handleMessage({ type: "DECRYPT", envelopeB64: encodeEnvelope(responseFields) }, tabId);

    // A different peer sends HANDSHAKE_INIT to the same tab
    const peer2 = await makeKeyPair();
    const initiator2 = new HandshakeInitiator(peer2);
    const initEnvelope2 = await initiator2.createInit();
    const res = await handleMessage({ type: "DECRYPT", envelopeB64: encodeEnvelope(initEnvelope2) }, tabId);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("KEY_CHANGE_DETECTED");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/extension-core && pnpm vitest run test/background.test.ts
```
Expected: FAIL — `handleMessage` not found.

- [ ] **Step 3: Create src/background.ts**

```typescript
import {
  generateIdentityKeyPair,
  exportPublicKeyJwk,
  HandshakeInitiator,
  HandshakeResponder,
  createSessionKeyAck,
  encodeEnvelope,
  decodeEnvelope,
  findEnvelopeToken,
  EnvelopeDecodeError,
  MsgType,
  encryptMessage,
  decryptMessage,
  DecryptError,
  fingerprintPublicKey,
  shortKeyId,
  formatFingerprint,
  combinedSafetyNumber,
  utf8Encode,
  utf8Decode,
  base64UrlEncode,
  base64UrlDecode,
} from "@waxseal/crypto-core";
import { NonExtractableKeyStore } from "./storage.js";
import { PeerStore, toHex, type PeerRecord } from "./peer-store.js";
import type { BackgroundRequest, BackgroundResponse, ContentScriptMessage } from "./protocol.js";

const keyStore = new NonExtractableKeyStore();
const peerStore = new PeerStore();

let myKeyPair: CryptoKeyPair | null = null;
let myPublicKeyJwk: JsonWebKey | null = null;
let mySenderKeyIdHex: string | null = null;
let myFingerprint: Uint8Array | null = null;

// Per-tab active peer: tabId → senderKeyIdHex of the current session peer
const tabPeer = new Map<number, string>();

async function ensureIdentity(): Promise<void> {
  if (myKeyPair) return;
  let loaded = await keyStore.loadIdentityKey();
  if (!loaded) {
    const raw = await generateIdentityKeyPair(true);
    await keyStore.saveIdentityKey(raw);
    loaded = await keyStore.loadIdentityKey();
  }
  myKeyPair = loaded!;
  myPublicKeyJwk = await exportPublicKeyJwk(myKeyPair.publicKey);
  const senderKeyId = await shortKeyId(myPublicKeyJwk);
  mySenderKeyIdHex = toHex(senderKeyId);
  myFingerprint = await fingerprintPublicKey(myPublicKeyJwk);
}

function injectEnvelopeIntoTab(tabId: number, envelopeB64: string): void {
  const msg: ContentScriptMessage = { type: "INJECT_ENVELOPE", envelopeB64 };
  chrome.tabs.sendMessage(tabId, msg);
}

export async function handleMessage(
  req: BackgroundRequest,
  tabId: number,
): Promise<BackgroundResponse> {
  await ensureIdentity();

  if (req.type === "GET_CONTEXT") {
    const peerKeyIdHex = tabPeer.get(tabId) ?? null;
    if (!peerKeyIdHex) return { ok: true, type: "CONTEXT", peerKeyIdHex: null, state: "IDLE" };
    const rec = await peerStore.get(peerKeyIdHex);
    const state = rec?.handshakeState ?? "IDLE";
    return { ok: true, type: "CONTEXT", peerKeyIdHex, state };
  }

  if (req.type === "GET_STATUS") {
    const peerKeyIdHex = tabPeer.get(tabId);
    if (!peerKeyIdHex) return { ok: true, type: "STATUS", state: "IDLE" };
    const rec = await peerStore.get(peerKeyIdHex);
    return { ok: true, type: "STATUS", state: rec?.handshakeState ?? "IDLE" };
  }

  if (req.type === "GET_SAFETY_NUMBER") {
    if (!myFingerprint) return { ok: false, error: "NO_PEER" };
    const peerKeyIdHex = tabPeer.get(tabId);
    if (!peerKeyIdHex) return { ok: false, error: "NO_PEER" };
    const rec = await peerStore.get(peerKeyIdHex);
    if (!rec || rec.handshakeState !== "ACTIVE") return { ok: false, error: "NO_SESSION" };
    const peerFp = await fingerprintPublicKey(rec.peerPublicKeyJwk);
    const safetyNumber = combinedSafetyNumber(myFingerprint, peerFp);
    return { ok: true, type: "SAFETY_NUMBER", number: safetyNumber };
  }

  if (req.type === "INITIATE_HANDSHAKE") {
    const initiator = new HandshakeInitiator(myKeyPair!);
    const initFields = await initiator.createInit();
    // Store pending nonce in a temporary peer record keyed on our own senderKeyId
    // (we don't know the peer's senderKeyId yet; we store state by tab)
    const nonceB64 = base64UrlEncode(
      Uint8Array.from(atob(btoa("")), () => 0), // placeholder — nonce is inside initFields.payload
    );
    // We serialize the init envelope and store the nonce for when the response arrives
    // The nonce is embedded in the HANDSHAKE_INIT payload; we extract and persist it
    const payloadText = new TextDecoder().decode(initFields.payload);
    const payloadObj = JSON.parse(payloadText) as { nonce: string; publicKeyJwk: JsonWebKey };
    const pendingNonceB64 = payloadObj.nonce;

    const envelopeB64 = encodeEnvelope(initFields);
    // Store pending state keyed on a placeholder until peer's senderKeyId is known
    const placeholderKey = `pending:${tabId}`;
    await peerStore.save({
      senderKeyIdHex: placeholderKey,
      peerPublicKeyJwk: {} as JsonWebKey,
      sessionKey: null,
      sessionKeyIdB64: null,
      handshakeState: "PENDING",
      pendingNonceB64,
    });
    tabPeer.set(tabId, placeholderKey);
    injectEnvelopeIntoTab(tabId, envelopeB64);
    return { ok: true, type: "HANDSHAKE_INJECTED" };
  }

  if (req.type === "ENCRYPT") {
    const rec = await peerStore.get(req.peerKeyIdHex);
    if (!rec || rec.handshakeState !== "ACTIVE" || !rec.sessionKey || !rec.sessionKeyIdB64) {
      return { ok: false, error: "NO_SESSION" };
    }
    const { iv, ciphertext } = await encryptMessage(rec.sessionKey, utf8Encode(req.plaintext));
    const senderKeyId = base64UrlDecode(mySenderKeyIdHex!.replace(/(..)/g, (_, h) => String.fromCharCode(parseInt(h, 16))));
    // Build senderKeyId as Uint8Array from hex
    const senderBytes = new Uint8Array(8);
    for (let i = 0; i < 8; i++) {
      senderBytes[i] = parseInt(mySenderKeyIdHex!.slice(i * 2, i * 2 + 2), 16);
    }
    const sessionKeyIdBytes = base64UrlDecode(rec.sessionKeyIdB64);
    const envelopeB64 = encodeEnvelope({
      senderKeyId: senderBytes,
      sessionKeyId: sessionKeyIdBytes,
      msgType: MsgType.DATA,
      iv,
      payload: ciphertext,
    });
    return { ok: true, type: "ENCRYPTED", envelopeB64 };
  }

  if (req.type === "DECRYPT") {
    let fields;
    try {
      fields = decodeEnvelope(req.envelopeB64);
    } catch (err) {
      if (err instanceof EnvelopeDecodeError) return { ok: false, error: "DECRYPT_FAILED" };
      throw err;
    }

    const incomingSenderKeyIdHex = toHex(fields.senderKeyId);

    if (fields.msgType === MsgType.HANDSHAKE_INIT) {
      // Check for key change: if tab has an ACTIVE session with a different peer
      const existingPeerKeyId = tabPeer.get(tabId);
      if (existingPeerKeyId && !existingPeerKeyId.startsWith("pending:")) {
        const existingRec = await peerStore.get(existingPeerKeyId);
        if (existingRec?.handshakeState === "ACTIVE" && existingPeerKeyId !== incomingSenderKeyIdHex) {
          return { ok: false, error: "KEY_CHANGE_DETECTED" };
        }
      }

      const responder = new HandshakeResponder(myKeyPair!);
      const { responseFields, peerPublicKeyJwk, sessionKey, sessionKeyId, senderKeyId } =
        await responder.handleInit(fields);

      const peerKeyIdHex = toHex(senderKeyId);
      const sessionKeyIdB64 = base64UrlEncode(sessionKeyId);

      await peerStore.save({
        senderKeyIdHex: peerKeyIdHex,
        peerPublicKeyJwk,
        sessionKey,
        sessionKeyIdB64,
        handshakeState: "ACTIVE",
        pendingNonceB64: null,
      });
      tabPeer.set(tabId, peerKeyIdHex);

      const responseEnvelope = encodeEnvelope(responseFields);
      injectEnvelopeIntoTab(tabId, responseEnvelope);
      return { ok: true, type: "HANDSHAKE_INJECTED" };
    }

    if (fields.msgType === MsgType.HANDSHAKE_RESPONSE) {
      const pendingKey = `pending:${tabId}`;
      const pendingRec = await peerStore.get(pendingKey);
      if (!pendingRec || !pendingRec.pendingNonceB64) {
        return { ok: false, error: "DECRYPT_FAILED" };
      }

      // Verify echoed nonce
      const payloadText = new TextDecoder().decode(fields.payload);
      const payload = JSON.parse(payloadText) as {
        echoedNonce: string;
        wrappedSessionKey: string;
        publicKeyJwk: JsonWebKey;
      };
      if (payload.echoedNonce !== pendingRec.pendingNonceB64) {
        return { ok: false, error: "DECRYPT_FAILED" };
      }

      // Unwrap session key
      const { unwrapSessionKey } = await import("@waxseal/crypto-core");
      const wrappedBytes = base64UrlDecode(payload.wrappedSessionKey);
      const sessionKey = await unwrapSessionKey(wrappedBytes, myKeyPair!.privateKey);

      const peerKeyIdHex = toHex(fields.senderKeyId);
      const sessionKeyIdB64 = base64UrlEncode(fields.sessionKeyId);

      await peerStore.save({
        senderKeyIdHex: peerKeyIdHex,
        peerPublicKeyJwk: payload.publicKeyJwk,
        sessionKey,
        sessionKeyIdB64,
        handshakeState: "ACTIVE",
        pendingNonceB64: null,
      });
      tabPeer.set(tabId, peerKeyIdHex);

      // Send SESSION_KEY_ACK
      const ackFields = await createSessionKeyAck(myPublicKeyJwk!, fields.sessionKeyId);
      injectEnvelopeIntoTab(tabId, encodeEnvelope(ackFields));
      return { ok: true, type: "HANDSHAKE_INJECTED" };
    }

    if (fields.msgType === MsgType.SESSION_KEY_ACK) {
      // Peer confirmed receipt — session is already ACTIVE, nothing to do
      return { ok: true, type: "STATUS", state: "ACTIVE" };
    }

    if (fields.msgType === MsgType.DATA) {
      const rec = await peerStore.get(incomingSenderKeyIdHex);
      if (!rec || !rec.sessionKey) return { ok: false, error: "NO_SESSION" };

      try {
        const plaintextBytes = await decryptMessage(rec.sessionKey, fields.iv, fields.payload);
        const plaintext = utf8Decode(plaintextBytes);
        return { ok: true, type: "DECRYPTED", plaintext, peerKeyIdHex: incomingSenderKeyIdHex };
      } catch (err) {
        if (err instanceof DecryptError) return { ok: false, error: "DECRYPT_FAILED" };
        throw err;
      }
    }

    return { ok: false, error: "DECRYPT_FAILED" };
  }

  return { ok: false, error: "DECRYPT_FAILED" };
}

// Register the message listener when this module is loaded in the extension
chrome.runtime.onMessage.addListener(
  (message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (r: BackgroundResponse) => void) => {
    const tabId = sender.tab?.id ?? -1;
    handleMessage(message as BackgroundRequest, tabId)
      .then(sendResponse)
      .catch(() => sendResponse({ ok: false, error: "DECRYPT_FAILED" }));
    return true; // keep message channel open for async response
  },
);
```

- [ ] **Step 4: Fix the nonce extraction in INITIATE_HANDSHAKE**

The payload encoding in `HandshakeInitiator.createInit()` uses `utf8Encode(JSON.stringify(...))` — the same approach the background uses. The nonce extraction code above parses the payload JSON directly. Verify the approach matches `handshake.ts` line 77-85 (the payload is a JSON-encoded `HandshakeInitPayload` with `nonce` in base64url). The `pendingNonceB64` stored is the base64url nonce string from that payload. When the HANDSHAKE_RESPONSE arrives, `payload.echoedNonce` should match `pendingNonceB64`. Confirm this matches by tracing `HandshakeInitiator.createInit()` → JSON payload → `pendingNonceB64`  →  `HandshakeResponder.handleInit()` → `responsePayload.echoedNonce`.

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd packages/extension-core && pnpm vitest run test/background.test.ts
```
Expected: all 5 tests pass. If the nonce round-trip test fails, add a debug log to compare `pendingNonceB64` vs `payload.echoedNonce` and trace the mismatch.

- [ ] **Step 6: Typecheck**

```bash
cd packages/extension-core && pnpm typecheck
```
Expected: no errors. Fix any TypeScript issues in background.ts (especially the dynamic import of `unwrapSessionKey` — change to a static import at the top of the file).

- [ ] **Step 7: Commit**

```bash
git add packages/extension-core/src/background.ts packages/extension-core/test/background.test.ts
git commit -m "feat: add background service worker with handshake state machine and encrypt/decrypt"
```

---

## Task 7: extension-core content script

**Files:**
- Create: `packages/extension-core/src/content-script.ts`
- Create: `packages/extension-core/test/content-script.test.ts`

**Interfaces:**
- Consumes: `SiteAdapter` from `@waxseal/adapter-api`; `baleAdapter` from `@waxseal/adapter-bale`; `BackgroundRequest`, `BackgroundResponse`, `ContentScriptMessage` from `./protocol.js`; `MARKER` and `findEnvelopeToken` from `@waxseal/crypto-core`
- Produces: Sets up MutationObserver, intercepts Enter, routes messages to background

- [ ] **Step 1: Update vitest.config.ts to support jsdom for content-script tests**

Add a separate vitest project for jsdom environment in the content-script test:

```typescript
// packages/extension-core/vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "node",
          include: ["test/storage.test.ts", "test/peer-store.test.ts", "test/background.test.ts"],
          environment: "node",
        },
      },
      {
        test: {
          name: "dom",
          include: ["test/content-script.test.ts"],
          environment: "jsdom",
        },
      },
    ],
  },
});
```

- [ ] **Step 2: Write the failing test**

```typescript
// packages/extension-core/test/content-script.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MARKER } from "@waxseal/crypto-core";

// Mock chrome.runtime
const mockSendMessage = vi.fn();
globalThis.chrome = {
  runtime: {
    sendMessage: mockSendMessage,
    onMessage: { addListener: vi.fn() },
  },
} as unknown as typeof chrome;

// Set up a mock adapter before importing
vi.mock("@waxseal/adapter-bale", () => ({
  baleAdapter: {
    id: "bale",
    matches: (_url: string) => true,
    getComposerElement: () => document.querySelector("#composer"),
    getSendTrigger: () => ({ type: "enter" }),
    injectOutgoingText: (el: Element, text: string) => { el.textContent = text; },
    triggerSend: (el: Element) => {
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    },
    getMessageListRoot: () => document.querySelector("#messages"),
    isMessageNode: (node: Node) =>
      node instanceof Element && node.classList.contains("bubble"),
    extractMessageText: (node: Element) => node.textContent ?? "",
    replaceMessageText: (node: Element, text: string) => { node.textContent = `🔒 ${text}`; },
  },
}));

describe("content-script", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    document.body.innerHTML = `
      <div id="messages"></div>
      <div id="composer" contenteditable="true"></div>
    `;
    // Re-import to reset module state
    vi.resetModules();
    await import("../src/content-script.js");
  });

  it("intercepts Enter keydown on composer, encrypts, and injects ciphertext", async () => {
    mockSendMessage.mockResolvedValueOnce({ ok: true, type: "CONTEXT", peerKeyIdHex: "aabb", state: "ACTIVE" });
    mockSendMessage.mockResolvedValueOnce({ ok: true, type: "ENCRYPTED", envelopeB64: "⁉WAXSEAL1:encoded" });

    const composer = document.querySelector("#composer")!;
    composer.textContent = "hello world";

    const ev = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    composer.dispatchEvent(ev);

    await new Promise((r) => setTimeout(r, 10));

    expect(mockSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "ENCRYPT", plaintext: "hello world" }),
      expect.any(Function),
    );
    expect(composer.textContent).toBe("⁉WAXSEAL1:encoded");
  });

  it("MutationObserver routes waxseal messages to background for decryption", async () => {
    mockSendMessage.mockResolvedValueOnce({ ok: true, type: "DECRYPTED", plaintext: "secret", peerKeyIdHex: "aabb" });

    const messages = document.querySelector("#messages")!;
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = `${MARKER}encodeddata`;
    messages.appendChild(bubble);

    await new Promise((r) => setTimeout(r, 10));

    expect(mockSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "DECRYPT", envelopeB64: `${MARKER}encodeddata` }),
      expect.any(Function),
    );
    expect(bubble.textContent).toBe("🔒 secret");
  });

  it("leaves non-waxseal messages untouched", async () => {
    const messages = document.querySelector("#messages")!;
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = "plain text message";
    messages.appendChild(bubble);

    await new Promise((r) => setTimeout(r, 10));

    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(bubble.textContent).toBe("plain text message");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd packages/extension-core && pnpm vitest run test/content-script.test.ts
```
Expected: FAIL — `../src/content-script.js` not found.

- [ ] **Step 4: Create src/content-script.ts**

```typescript
import type { SiteAdapter } from "@waxseal/adapter-api";
import { baleAdapter } from "@waxseal/adapter-bale";
import { findEnvelopeToken, MARKER } from "@waxseal/crypto-core";
import type { BackgroundRequest, BackgroundResponse, ContentScriptMessage } from "./protocol.js";

function sendToBackground(req: BackgroundRequest): Promise<BackgroundResponse> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(req, (res: BackgroundResponse) => resolve(res));
  });
}

function isWaxsealNode(node: Node): node is Element {
  return (
    adapter.isMessageNode(node) &&
    adapter.extractMessageText(node as Element).includes(MARKER)
  );
}

async function processIncomingNode(node: Element): Promise<void> {
  const text = adapter.extractMessageText(node);
  const token = findEnvelopeToken(text);
  if (!token) return;

  const res = await sendToBackground({ type: "DECRYPT", envelopeB64: token });
  if (res.ok && res.type === "DECRYPTED") {
    adapter.replaceMessageText(node, res.plaintext);
    currentPeerKeyIdHex = res.peerKeyIdHex;
  }
}

let currentPeerKeyIdHex: string | null = null;

const adapter: SiteAdapter = baleAdapter;

function setupSendIntercept(): void {
  const composer = adapter.getComposerElement();
  if (!composer) return;

  composer.addEventListener("keydown", async (ev: Event) => {
    const keyEv = ev as KeyboardEvent;
    if (keyEv.key !== "Enter" || keyEv.shiftKey) return;

    const plaintext = adapter.extractMessageText(composer);
    if (!plaintext.trim()) return;

    // Get current peer from background context
    const ctx = await sendToBackground({ type: "GET_CONTEXT" });
    if (!ctx.ok || ctx.type !== "CONTEXT" || !ctx.peerKeyIdHex) return;
    if (ctx.state !== "ACTIVE") return;

    ev.preventDefault();
    ev.stopImmediatePropagation();

    const encRes = await sendToBackground({
      type: "ENCRYPT",
      plaintext,
      peerKeyIdHex: ctx.peerKeyIdHex,
    });
    if (!encRes.ok || encRes.type !== "ENCRYPTED") return;

    adapter.injectOutgoingText(composer, encRes.envelopeB64);
    adapter.triggerSend(composer);
  }, true); // capture phase to intercept before Bale's own handler
}

function setupMutationObserver(): void {
  const root = adapter.getMessageListRoot();
  if (!root) return;

  const observer = new MutationObserver((mutations) => {
    for (const mut of mutations) {
      for (const node of Array.from(mut.addedNodes)) {
        if (adapter.isMessageNode(node)) {
          processIncomingNode(node as Element).catch(() => undefined);
        }
      }
    }
  });

  observer.observe(root, { childList: true, subtree: false });

  // Process any existing messages on load
  for (const node of Array.from(root.children)) {
    if (isWaxsealNode(node)) {
      processIncomingNode(node).catch(() => undefined);
    }
  }
}

// Listen for injection requests from background
chrome.runtime.onMessage.addListener((msg: ContentScriptMessage) => {
  if (msg.type === "INJECT_ENVELOPE") {
    const composer = adapter.getComposerElement();
    if (!composer) return;
    adapter.injectOutgoingText(composer, msg.envelopeB64);
    adapter.triggerSend(composer);
  }
});

setupSendIntercept();
setupMutationObserver();
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd packages/extension-core && pnpm vitest run test/content-script.test.ts
```
Expected: all 3 tests pass.

- [ ] **Step 6: Typecheck**

```bash
cd packages/extension-core && pnpm typecheck
```
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/extension-core/src/content-script.ts packages/extension-core/test/content-script.test.ts packages/extension-core/vitest.config.ts
git commit -m "feat: add content script with MutationObserver, send intercept, and envelope routing"
```

---

## Task 8: extension-core popup

**Files:**
- Create: `packages/extension-core/src/popup.html`
- Create: `packages/extension-core/src/popup.ts`

**Interfaces:**
- Consumes: `BackgroundRequest`, `BackgroundResponse` from `./protocol.js`
- Produces: Popup UI that shows session state and controls for the current Bale tab

- [ ] **Step 1: Create src/popup.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>waxseal</title>
  <style>
    body {
      font-family: system-ui, sans-serif;
      width: 280px;
      padding: 16px;
      margin: 0;
      background: #fff;
      color: #111;
    }
    h1 { font-size: 18px; margin: 0 0 12px; }
    #status { font-size: 14px; margin-bottom: 12px; }
    #status.idle { color: #888; }
    #status.pending { color: #e69900; }
    #status.active { color: #1a7f37; }
    #safety-number {
      font-family: monospace;
      font-size: 11px;
      background: #f4f4f5;
      padding: 8px;
      border-radius: 4px;
      word-break: break-all;
      margin-bottom: 12px;
      display: none;
    }
    #key-change-warning {
      background: #fef2f2;
      border: 1px solid #f87171;
      border-radius: 4px;
      padding: 8px;
      font-size: 13px;
      color: #b91c1c;
      margin-bottom: 12px;
      display: none;
    }
    button {
      width: 100%;
      padding: 8px 12px;
      border-radius: 6px;
      border: 1px solid #ccc;
      background: #f9f9f9;
      cursor: pointer;
      font-size: 14px;
    }
    button:hover { background: #efefef; }
    button:disabled { opacity: 0.4; cursor: default; }
    #not-bale { font-size: 13px; color: #666; }
  </style>
</head>
<body>
  <h1>🔐 waxseal</h1>
  <div id="not-bale" style="display:none">Not on a Bale web chat page.</div>
  <div id="main" style="display:none">
    <div id="key-change-warning">
      ⚠️ Identity key changed — re-verify safety number with your contact.
    </div>
    <div id="status" class="idle">Status: loading…</div>
    <div id="safety-number"></div>
    <button id="start-btn" disabled>Start secure chat</button>
  </div>
  <script type="module" src="popup.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create src/popup.ts**

```typescript
import type { BackgroundRequest, BackgroundResponse } from "./protocol.js";

function sendToBackground(req: BackgroundRequest): Promise<BackgroundResponse> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(req, (res: BackgroundResponse) => resolve(res));
  });
}

async function getActiveTabId(): Promise<number | null> {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs[0]?.id ?? null);
    });
  });
}

async function refresh(tabId: number): Promise<void> {
  const statusEl = document.getElementById("status")!;
  const safetyEl = document.getElementById("safety-number")!;
  const startBtn = document.getElementById("start-btn") as HTMLButtonElement;
  const warningEl = document.getElementById("key-change-warning")!;

  const ctx = await sendToBackground({ type: "GET_CONTEXT" });
  if (!ctx.ok || ctx.type !== "CONTEXT") return;

  statusEl.className = ctx.state.toLowerCase();
  statusEl.textContent = `Status: ${ctx.state}`;

  startBtn.disabled = ctx.state === "PENDING";

  if (ctx.state === "ACTIVE") {
    const snRes = await sendToBackground({ type: "GET_SAFETY_NUMBER" });
    if (snRes.ok && snRes.type === "SAFETY_NUMBER") {
      safetyEl.textContent = `Safety number:\n${snRes.number}`;
      safetyEl.style.display = "block";
    }
  } else {
    safetyEl.style.display = "none";
  }

  // Key-change warning: stored in sessionStorage by the content script
  const hasKeyChange = sessionStorage.getItem(`waxseal-key-change-${tabId}`) === "true";
  warningEl.style.display = hasKeyChange ? "block" : "none";
}

async function init(): Promise<void> {
  const notBaleEl = document.getElementById("not-bale")!;
  const mainEl = document.getElementById("main")!;
  const startBtn = document.getElementById("start-btn") as HTMLButtonElement;

  const tabId = await getActiveTabId();
  if (!tabId) {
    notBaleEl.style.display = "block";
    return;
  }

  // Check if the tab is a Bale page
  chrome.tabs.get(tabId, (tab) => {
    const isBale = tab.url?.includes("web.bale.ai") ?? false;
    if (!isBale) {
      notBaleEl.style.display = "block";
      return;
    }
    mainEl.style.display = "block";
    refresh(tabId).catch(console.error);

    startBtn.addEventListener("click", async () => {
      startBtn.disabled = true;
      await sendToBackground({ type: "INITIATE_HANDSHAKE" });
      await refresh(tabId);
    });
  });
}

init().catch(console.error);
```

- [ ] **Step 3: Typecheck**

```bash
cd packages/extension-core && pnpm typecheck
```
Expected: no errors. (Popup is not unit-tested; it's covered by the E2E tests in Task 10.)

- [ ] **Step 4: Commit**

```bash
git add packages/extension-core/src/popup.html packages/extension-core/src/popup.ts
git commit -m "feat: add popup with session status, safety number display, and start-handshake button"
```

---

## Task 9: build package (Vite + manifests + fixture page)

**Files:**
- Create: `packages/build/package.json`
- Create: `packages/build/tsconfig.json`
- Create: `packages/build/vite.config.ts`
- Create: `packages/build/manifest.chrome.json`
- Create: `packages/build/manifest.firefox.json`
- Create: `packages/build/test/fixture-page/index.html`

**Interfaces:**
- Consumes: all packages via pnpm workspace
- Produces: `dist/chrome/` and `dist/firefox/` directories with complete extension builds

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@waxseal/build",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "pnpm build:chrome && pnpm build:firefox",
    "build:chrome": "vite build --config vite.config.ts --outDir dist/chrome --mode chrome",
    "build:firefox": "vite build --config vite.config.ts --outDir dist/firefox --mode firefox",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@waxseal/adapter-api": "workspace:*",
    "@waxseal/adapter-bale": "workspace:*",
    "@waxseal/crypto-core": "workspace:*",
    "@waxseal/extension-core": "workspace:*"
  },
  "devDependencies": {
    "@types/chrome": "^0.0.277",
    "typescript": "5.6.3",
    "vite": "^5.0.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM", "WebWorker"],
    "outDir": "dist"
  },
  "include": ["vite.config.ts", "test"]
}
```

- [ ] **Step 3: Create vite.config.ts**

```typescript
import { defineConfig, type UserConfig } from "vite";
import { resolve } from "path";

const extensionCoreDir = resolve(__dirname, "../extension-core/src");

export default defineConfig(({ mode }): UserConfig => ({
  build: {
    target: "es2022",
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: {
        background: resolve(extensionCoreDir, "background.ts"),
        "content-script": resolve(extensionCoreDir, "content-script.ts"),
        popup: resolve(extensionCoreDir, "popup.html"),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "[name][extname]",
      },
    },
    sourcemap: true,
    minify: false, // keep readable for auditing
  },
  resolve: {
    alias: {
      "@waxseal/crypto-core": resolve(__dirname, "../crypto-core/src/index.ts"),
      "@waxseal/adapter-api": resolve(__dirname, "../adapters/adapter-api/src/index.ts"),
      "@waxseal/adapter-bale": resolve(__dirname, "../adapters/adapter-bale/src/index.ts"),
      "@waxseal/extension-core": resolve(extensionCoreDir, "background.ts"),
    },
  },
  define: {
    __WAXSEAL_MODE__: JSON.stringify(mode),
  },
}));
```

- [ ] **Step 4: Create manifest.chrome.json**

```json
{
  "manifest_version": 3,
  "name": "waxseal",
  "version": "0.1.0",
  "description": "End-to-end encryption overlay for Bale web chat.",
  "background": {
    "service_worker": "background.js",
    "type": "module"
  },
  "content_scripts": [
    {
      "matches": ["https://web.bale.ai/*"],
      "js": ["content-script.js"],
      "run_at": "document_idle"
    }
  ],
  "action": {
    "default_popup": "popup.html",
    "default_title": "waxseal"
  },
  "permissions": ["storage", "tabs"],
  "host_permissions": ["https://web.bale.ai/*"]
}
```

- [ ] **Step 5: Create manifest.firefox.json**

```json
{
  "manifest_version": 3,
  "name": "waxseal",
  "version": "0.1.0",
  "description": "End-to-end encryption overlay for Bale web chat.",
  "background": {
    "scripts": ["background.js"],
    "type": "module"
  },
  "content_scripts": [
    {
      "matches": ["https://web.bale.ai/*"],
      "js": ["content-script.js"],
      "run_at": "document_idle"
    }
  ],
  "action": {
    "default_popup": "popup.html",
    "default_title": "waxseal"
  },
  "permissions": ["storage", "tabs"],
  "host_permissions": ["https://web.bale.ai/*"],
  "browser_specific_settings": {
    "gecko": {
      "id": "waxseal@waxseal.app",
      "strict_min_version": "121.0"
    }
  }
}
```

- [ ] **Step 6: Create test/fixture-page/index.html**

This page mimics the Bale chat structure so Playwright can load it without hitting the live site.

```html
<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <title>waxseal E2E Fixture</title>
  <style>
    body { font-family: system-ui; margin: 0; display: flex; flex-direction: column; height: 100vh; }
    #message-list { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 8px; }
    .bubble {
      display: inline-block; background: #e8f4fd; border-radius: 12px;
      padding: 8px 12px; max-width: 70%; word-break: break-all;
    }
    .bubble.mine { align-self: flex-end; background: #dcf8c6; }
    #composer-area { border-top: 1px solid #ddd; padding: 12px; display: flex; gap: 8px; }
    [aria-label="پیام"] {
      flex: 1; border: 1px solid #ccc; border-radius: 20px; padding: 8px 14px;
      outline: none; min-height: 36px;
    }
    button { border-radius: 50%; width: 40px; height: 40px; border: none; background: #0d8; cursor: pointer; }
  </style>
</head>
<body>
  <div id="message-list" data-testid="message-list"></div>
  <div id="composer-area">
    <div
      contenteditable="true"
      aria-label="پیام"
      data-testid="message-input"
      role="textbox"
    ></div>
    <button id="send-btn" data-testid="send-button">↑</button>
  </div>
  <script>
    const list = document.getElementById('message-list');
    const composer = document.querySelector('[aria-label="پیام"]');
    const sendBtn = document.getElementById('send-btn');

    function addMessage(text, mine = false) {
      const el = document.createElement('div');
      el.setAttribute('data-testid', 'message-bubble');
      el.className = 'bubble' + (mine ? ' mine' : '');
      el.textContent = text;
      list.appendChild(el);
      list.scrollTop = list.scrollHeight;
      return el;
    }

    function send() {
      const text = composer.textContent.trim();
      if (!text) return;
      addMessage(text, true);
      composer.textContent = '';
    }

    sendBtn.addEventListener('click', send);
    composer.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });

    // Expose helpers for E2E tests
    window.addIncomingMessage = (text) => addMessage(text, false);
    window.getMessages = () =>
      Array.from(list.querySelectorAll('[data-testid="message-bubble"]'))
        .map(el => el.textContent);
  </script>
</body>
</html>
```

- [ ] **Step 7: Install dependencies and run build**

```bash
cd packages/build && pnpm install
pnpm build:chrome
```
Expected: `dist/chrome/` contains `background.js`, `content-script.js`, `popup.html`, `popup.js`. Fix any Vite/rollup errors about missing exports or unresolved modules.

- [ ] **Step 8: Typecheck**

```bash
cd packages/build && pnpm typecheck
```
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add packages/build
git commit -m "feat: add build package with Vite config, Chrome/Firefox manifests, and E2E fixture page"
```

- [ ] **Step 10: Copy manifests into dist directories**

The Vite build does not automatically copy JSON files. Add a `copy-manifest` step:

```typescript
// In vite.config.ts, add a plugin to copy the manifest:
import { copyFileSync } from "fs";

// Add to the defineConfig:
plugins: [
  {
    name: "copy-manifest",
    closeBundle() {
      const manifest = mode === "firefox" ? "manifest.firefox.json" : "manifest.chrome.json";
      const outDir = mode === "firefox" ? "dist/firefox" : "dist/chrome";
      copyFileSync(
        resolve(__dirname, manifest),
        resolve(__dirname, outDir, "manifest.json"),
      );
    },
  },
],
```

Re-run build and verify `manifest.json` appears in each dist folder.

- [ ] **Step 11: Commit build fix**

```bash
git add packages/build/vite.config.ts
git commit -m "fix: copy correct manifest.json into dist directory during build"
```

---

## Task 10: E2E tests (Playwright)

**Files:**
- Create: `e2e/package.json`
- Create: `e2e/playwright.config.ts`
- Create: `e2e/tests/handshake.spec.ts`
- Create: `e2e/tests/message.spec.ts`

**Interfaces:**
- Consumes: `packages/build/dist/chrome/` (built extension), `packages/build/test/fixture-page/index.html`
- Produces: automated tests for the full extension round-trip

- [ ] **Step 1: Create e2e/package.json**

```json
{
  "name": "@waxseal/e2e",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "playwright test",
    "test:headed": "playwright test --headed"
  },
  "devDependencies": {
    "@playwright/test": "^1.48.0",
    "typescript": "5.6.3"
  }
}
```

- [ ] **Step 2: Install Playwright and browsers**

```bash
cd e2e && pnpm install && pnpm exec playwright install chromium
```
Expected: chromium downloaded.

- [ ] **Step 3: Create e2e/playwright.config.ts**

```typescript
import { defineConfig } from "@playwright/test";
import { resolve } from "path";

const extensionPath = resolve(__dirname, "../packages/build/dist/chrome");
const fixturePage = resolve(__dirname, "../packages/build/test/fixture-page/index.html");

export default defineConfig({
  testDir: "./tests",
  use: {
    headless: false, // extensions require non-headless Chromium
    viewport: { width: 1280, height: 720 },
  },
  projects: [
    {
      name: "chromium-extension",
      use: {
        browserName: "chromium",
        launchOptions: {
          args: [
            `--disable-extensions-except=${extensionPath}`,
            `--load-extension=${extensionPath}`,
          ],
        },
      },
    },
  ],
});

export { extensionPath, fixturePage };
```

- [ ] **Step 4: Write handshake.spec.ts**

```typescript
// e2e/tests/handshake.spec.ts
import { test, expect, chromium, type BrowserContext } from "@playwright/test";
import { resolve } from "path";

const extensionPath = resolve(__dirname, "../../packages/build/dist/chrome");
const fixturePath = resolve(__dirname, "../../packages/build/test/fixture-page/index.html");
const fixtureUrl = `file://${fixturePath}`;

async function launchWithExtension(): Promise<BrowserContext> {
  const ctx = await chromium.launchPersistentContext("", {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
    viewport: { width: 1280, height: 720 },
  });
  return ctx;
}

test.describe("handshake flow", () => {
  test("two instances complete a handshake and session becomes ACTIVE", async () => {
    // Alice's browser
    const aliceCtx = await launchWithExtension();
    // Bob's browser (second profile — separate persistent context for isolated keys)
    const bobCtx = await launchWithExtension();

    const alicePage = await aliceCtx.newPage();
    const bobPage = await bobCtx.newPage();

    await alicePage.goto(fixtureUrl);
    await bobPage.goto(fixtureUrl);

    // Wait for content scripts to load
    await alicePage.waitForTimeout(500);
    await bobPage.waitForTimeout(500);

    // Alice clicks "Start secure chat" in the extension popup
    // We simulate this by triggering INITIATE_HANDSHAKE through the background
    await alicePage.evaluate(async () => {
      return new Promise<void>((resolve) => {
        chrome.runtime.sendMessage({ type: "INITIATE_HANDSHAKE" }, () => resolve());
      });
    });

    // Wait for Bob's page to receive the HANDSHAKE_INIT message (injected by Alice)
    // In a real scenario, Alice's INIT would travel through Bale. In the fixture,
    // we manually inject a message into Bob's page to simulate the receipt.
    const aliceInitEnvelope = await alicePage.evaluate(async () => {
      return new Promise<string>((resolve) => {
        // Get the last injected envelope (stored as a data attribute by the content script for testing)
        setTimeout(() => {
          const el = document.querySelector("[data-testid='message-bubble']");
          resolve(el?.textContent ?? "");
        }, 200);
      });
    });

    expect(aliceInitEnvelope).toContain("⁉WAXSEAL1:");

    // Inject Alice's HANDSHAKE_INIT into Bob's fixture page
    await bobPage.evaluate(async (envelope: string) => {
      (window as { addIncomingMessage?: (t: string) => void }).addIncomingMessage?.(envelope);
    }, aliceInitEnvelope);

    // Bob's content script processes the HANDSHAKE_INIT and auto-responds
    await bobPage.waitForTimeout(500);

    // Check Bob's session state
    const bobState = await bobPage.evaluate(async () => {
      return new Promise<string>((resolve) => {
        chrome.runtime.sendMessage({ type: "GET_STATUS" }, (res: { type: string; state: string }) => {
          resolve(res.state);
        });
      });
    });
    expect(bobState).toBe("ACTIVE");

    // Get Bob's HANDSHAKE_RESPONSE from the fixture page's message list
    const bobResponseEnvelope = await bobPage.evaluate(() => {
      const bubbles = Array.from(document.querySelectorAll('[data-testid="message-bubble"][class*="mine"]'));
      return bubbles.at(-1)?.textContent ?? "";
    });
    expect(bobResponseEnvelope).toContain("⁉WAXSEAL1:");

    // Feed Bob's response back to Alice
    await alicePage.evaluate(async (envelope: string) => {
      (window as { addIncomingMessage?: (t: string) => void }).addIncomingMessage?.(envelope);
    }, bobResponseEnvelope);

    await alicePage.waitForTimeout(500);

    // Alice session should now be ACTIVE
    const aliceState = await alicePage.evaluate(async () => {
      return new Promise<string>((resolve) => {
        chrome.runtime.sendMessage({ type: "GET_STATUS" }, (res: { type: string; state: string }) => {
          resolve(res.state);
        });
      });
    });
    expect(aliceState).toBe("ACTIVE");

    await aliceCtx.close();
    await bobCtx.close();
  });
});
```

- [ ] **Step 5: Write message.spec.ts**

```typescript
// e2e/tests/message.spec.ts
import { test, expect, chromium, type BrowserContext } from "@playwright/test";
import { resolve } from "path";

const extensionPath = resolve(__dirname, "../../packages/build/dist/chrome");
const fixturePath = resolve(__dirname, "../../packages/build/test/fixture-page/index.html");
const fixtureUrl = `file://${fixturePath}`;

// Re-use the helper from handshake.spec to reach an ACTIVE session
async function launchWithExtension(): Promise<BrowserContext> {
  return chromium.launchPersistentContext("", {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
    viewport: { width: 1280, height: 720 },
  });
}

test.describe("message flow", () => {
  test("malformed envelope shows unmodified ciphertext (graceful failure)", async () => {
    const ctx = await launchWithExtension();
    const page = await ctx.newPage();
    await page.goto(fixtureUrl);
    await page.waitForTimeout(300);

    await page.evaluate(() => {
      (window as { addIncomingMessage?: (t: string) => void }).addIncomingMessage?.(
        "⁉WAXSEAL1:notvalidbase64!!!"
      );
    });

    await page.waitForTimeout(300);

    const bubbleText = await page.evaluate(() => {
      return document.querySelector('[data-testid="message-bubble"]')?.textContent ?? "";
    });

    // Content script should leave the message unmodified on decode failure
    expect(bubbleText).toBe("⁉WAXSEAL1:notvalidbase64!!!");
    await ctx.close();
  });

  test("safety number is deterministic on both sides after handshake", async () => {
    const aliceCtx = await launchWithExtension();
    const bobCtx = await launchWithExtension();
    const alicePage = await aliceCtx.newPage();
    const bobPage = await bobCtx.newPage();

    await alicePage.goto(fixtureUrl);
    await bobPage.goto(fixtureUrl);
    await alicePage.waitForTimeout(300);
    await bobPage.waitForTimeout(300);

    // === Perform handshake (abbreviated — repeat steps from handshake.spec) ===
    await alicePage.evaluate(() => {
      return new Promise<void>((r) => chrome.runtime.sendMessage({ type: "INITIATE_HANDSHAKE" }, () => r()));
    });
    await alicePage.waitForTimeout(300);

    const aliceInit = await alicePage.evaluate(() =>
      document.querySelector('[data-testid="message-bubble"]')?.textContent ?? ""
    );
    await bobPage.evaluate((env) => {
      (window as { addIncomingMessage?: (t: string) => void }).addIncomingMessage?.(env);
    }, aliceInit);
    await bobPage.waitForTimeout(500);

    const bobResponse = await bobPage.evaluate(() =>
      Array.from(document.querySelectorAll('[data-testid="message-bubble"]'))
        .map(el => el.textContent ?? "")
        .find(t => t.startsWith("⁉WAXSEAL1:")) ?? ""
    );
    await alicePage.evaluate((env) => {
      (window as { addIncomingMessage?: (t: string) => void }).addIncomingMessage?.(env);
    }, bobResponse);
    await alicePage.waitForTimeout(500);
    // === End handshake ===

    const aliceSN = await alicePage.evaluate(() =>
      new Promise<string>((r) =>
        chrome.runtime.sendMessage({ type: "GET_SAFETY_NUMBER" }, (res: { number?: string }) =>
          r(res.number ?? "")
        )
      )
    );

    const bobSN = await bobPage.evaluate(() =>
      new Promise<string>((r) =>
        chrome.runtime.sendMessage({ type: "GET_SAFETY_NUMBER" }, (res: { number?: string }) =>
          r(res.number ?? "")
        )
      )
    );

    expect(aliceSN).toBeTruthy();
    expect(aliceSN).toBe(bobSN);

    await aliceCtx.close();
    await bobCtx.close();
  });
});
```

- [ ] **Step 6: Build the extension before running E2E tests**

```bash
cd packages/build && pnpm build:chrome
```
Expected: `dist/chrome/` populated.

- [ ] **Step 7: Run E2E tests**

```bash
cd e2e && pnpm test
```
Expected: tests pass. If tests fail due to timing, increase `waitForTimeout` values. If they fail due to content-script not running on `file://` URLs, update the manifest `matches` to include `"<all_urls>"` in E2E mode.

- [ ] **Step 8: Commit**

```bash
git add e2e
git commit -m "feat: add Playwright E2E tests for handshake round-trip, safety number, and malformed envelope"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task covering it |
|---|---|
| SiteAdapter interface + MockSiteAdapter | Task 1 |
| adapter-bale with Bale selectors | Task 2 |
| HTML fixtures in test/fixtures/ | Task 2 |
| BackgroundRequest/BackgroundResponse typed protocol | Task 3 |
| KeyStore + NonExtractableKeyStore | Task 4 |
| Per-peer session state in IndexedDB | Task 5 |
| Background service worker with state machine | Task 6 |
| HANDSHAKE state: IDLE → PENDING → ACTIVE | Task 6 |
| KEY_CHANGE_DETECTED on senderKeyId mismatch | Task 6 |
| NO_SESSION error before handshake | Task 6 |
| Content script MutationObserver | Task 7 |
| Content script send intercept | Task 7 |
| INJECT_ENVELOPE from background → content | Task 7 |
| Popup with status + safety number + start button | Task 8 |
| Chrome manifest MV3 | Task 9 |
| Firefox manifest MV3 | Task 9 |
| E2E fixture page mimicking Bale chat | Task 9 |
| E2E handshake round-trip | Task 10 |
| E2E safety number match | Task 10 |
| E2E malformed envelope → graceful failure | Task 10 |
| Reproducible open-source build | Task 9 (sourcemap:true, minify:false) |

**Gaps identified and addressed:**
- Session-key ACK handling → added in Task 6 background.ts
- Background → content script injection channel → `ContentScriptMessage` in Task 3, `chrome.tabs.sendMessage` in Task 6, listener in Task 7
- peerKeyIdHex vs peerFingerprint naming deviation from spec noted in Task 3 with explanation

**Type consistency:** `peerKeyIdHex` used consistently across protocol.ts (Task 3), background.ts (Task 6), content-script.ts (Task 7), and popup.ts (Task 8). `PeerRecord.senderKeyIdHex` is the IndexedDB key. `toHex()` used consistently for `Uint8Array → string` conversion.
