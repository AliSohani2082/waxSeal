# waxseal Product Roadmap Design

**Date:** 2026-07-02
**Status:** Approved — ready for implementation planning

---

## Core Principle: Transparency

The central guarantee waxseal makes to users is precise and auditable:

> "Even we cannot read your messages — and this is not a promise, it is a technical impossibility."

This guarantee rests on three pillars that must hold simultaneously at every phase:

| Pillar | How it is enforced |
|---|---|
| Private keys never leave the device in plaintext | Open-source client code + reproducible builds |
| The sync and wire protocols are public standards | `CRYPTO_DESIGN.md`, `WIRE_FORMAT.md`, and this document |
| The backend is a dumb relay — cryptographically blind | Protocol spec describes what the backend must and must not do |

The backend can be closed-source at every phase. The transparency guarantee never depends on the backend being open — it depends on the protocol being public and the clients being open source. Even under compulsion by a state actor, the backend operator cannot comply with a request to produce plaintext, because they do not have the keys.

---

## Phase Map

| Phase | Scope | Depends on |
|---|---|---|
| **1 — crypto-core** ✅ | Identity keys, handshake, envelope, session, fingerprints | — |
| **2 — Browser extension** | Extension shell + Bale adapter (PoC / credibility signal) | Phase 1 |
| **3 — Multi-device sync** | QR device linking + relay backend + storage layer upgrade | Phase 2 |
| **4 — Group chat + more adapters** | Sender Keys group protocol + Eitaa + Sorush+ adapters | Phase 3 |
| **5 — Double Ratchet** | Per-message forward secrecy (upgrade path already in wire format) | Phase 2 |
| **6 — Android** | Native crypto (Android Keystore), same wire format | Phase 3, 4 |
| **7 — iOS** | Native crypto (CryptoKit), same wire format | Phase 3, 4 |

Phase 2 is explicitly a **proof-of-concept and credibility signal**, not a mass-adoption target. One adapter (Bale), done well, published as an auditable reference.

---

## Phase 2: Browser Extension

### Goals

- Demonstrate the full encrypt/decrypt round-trip on Bale web
- Establish the adapter architecture that Phase 4 will extend to Eitaa and Sorush+
- Lay the storage interface seam that Phase 3 requires without building Phase 3 yet
- Ship as an open-source, reproducible Chrome and Firefox build

### Package Structure

```
packages/
  crypto-core/              ← Phase 1 — complete ✓
  adapters/
    adapter-api/            ← SiteAdapter interface + MockSiteAdapter test harness
    adapter-bale/           ← Bale web adapter, saved HTML fixtures, unit tests
  extension-core/           ← background worker, content-script logic, popup
  build/                    ← manifest.chrome.json, manifest.firefox.json, Vite config
```

Each package has its own `package.json`, `tsconfig.json`, and `vitest.config.ts`. `adapter-api` is a dependency of both `adapter-bale` and `extension-core`. `crypto-core` is a dependency of `extension-core` only — adapters never touch crypto directly.

### Responsibility Split

The cardinal rule: **all crypto happens in the background service worker**. The content script touches only the DOM. The popup is display-only.

```
Browser Tab (Bale web)
  └── Content Script
        - Instantiates adapter-bale
        - MutationObserver on message list
        - Intercepts send trigger
        - Detects ⁉WAXSEAL1: blobs, routes to background for decrypt
        - Injects ciphertext into composer on send
        │
        │ chrome.runtime.sendMessage (typed protocol)
        ▼
Background Service Worker
        - Identity keypair via KeyStore interface
        - Session state machine per peerFingerprint
        - Handshake state: IDLE / PENDING / ACTIVE
        - All SubtleCrypto calls
        - All IndexedDB access
        │
        │ chrome.runtime.sendMessage
        ▼
Popup
        - "Start secure chat" button → INITIATE_HANDSHAKE
        - Safety number display (read-only from background)
        - Encryption status: IDLE / PENDING / ACTIVE
        - Key-change warning banner
```

### Background Message Protocol

A typed discriminated union — no untyped message strings anywhere:

```typescript
// extension-core/src/protocol.ts

type BackgroundRequest =
  | { type: "ENCRYPT"; plaintext: string; peerFingerprint: string }
  | { type: "DECRYPT"; envelopeB64: string }
  | { type: "INITIATE_HANDSHAKE"; peerFingerprint: string }
  | { type: "GET_STATUS"; peerFingerprint: string }
  | { type: "GET_SAFETY_NUMBER"; peerFingerprint: string };

type BackgroundResponse =
  | { ok: true; type: "ENCRYPTED"; envelopeB64: string }
  | { ok: true; type: "DECRYPTED"; plaintext: string }
  | { ok: true; type: "HANDSHAKE_INJECTED" }
  | { ok: true; type: "STATUS"; state: "IDLE" | "PENDING" | "ACTIVE" }
  | { ok: true; type: "SAFETY_NUMBER"; number: string }
  | { ok: false; error: "NO_SESSION" | "DECRYPT_FAILED" | "KEY_CHANGE_DETECTED" };
```

The content script never sees raw `CryptoKey` objects or key bytes. It sends plaintext in, gets ciphertext back, and vice versa.

### Storage Interface Seam (Option C)

```typescript
// extension-core/src/storage.ts

interface KeyStore {
  loadIdentityKey(): Promise<CryptoKeyPair | null>;
  saveIdentityKey(pair: CryptoKeyPair): Promise<void>;
}

// Phase 2: NonExtractableKeyStore — keys stored as non-extractable CryptoKey in IndexedDB
// Phase 3: ExtractableKeyStore — same interface, keys exportable for sync
```

Phase 2 ships `NonExtractableKeyStore`. Phase 3 adds `ExtractableKeyStore` behind the same interface — nothing else in the codebase changes. Users who upgrade are told: "To enable multi-device sync, your identity keypair needs to be regenerated as exportable. Contacts will need to re-verify fingerprints." This is expected behavior, documented plainly.

### Content Script Flows

**Outgoing message:**
1. Send trigger fires (Enter keydown) → adapter intercepts
2. Content script reads composer text via `extractMessageText`
3. Sends `ENCRYPT` to background with `peerFingerprint`
4. Background returns ciphertext envelope
5. Content script calls `injectOutgoingText` + `triggerSend`
6. Ciphertext travels through Bale's servers as an opaque string

**Incoming message:**
1. MutationObserver fires on new DOM node
2. `isMessageNode` check + scan for `⁉WAXSEAL1:` marker
3. Sends `DECRYPT` to background
4. Background returns plaintext or `DECRYPT_FAILED`
5. `replaceMessageText` shows `🔒 plaintext` to user
6. On `KEY_CHANGE_DETECTED`: message left as-is, popup shows warning banner

**Handshake (receiving side):**
- Background detects `HANDSHAKE_INIT` / `HANDSHAKE_RESPONSE` by `msgType`
- Background owns the full state machine; content script only routes envelopes
- Background auto-sends responses by posting back to the active tab

**Handshake initiation (sending side):**
- User presses "Start secure chat" in popup
- Popup sends `INITIATE_HANDSHAKE` to background
- Background generates HANDSHAKE_INIT envelope, posts to content script
- Content script injects envelope into composer and triggers send

### Bale Adapter (`adapter-bale`)

```typescript
export const baleAdapter: SiteAdapter = {
  id: "bale",
  matches: (url) => url.includes("web.bale.ai"),
  getComposerElement: () => document.querySelector('[aria-label="پیام"]') ?? null,
  getSendTrigger: () => ({ type: "enter" }),
  injectOutgoingText: (el, ciphertext) => {
    el.textContent = ciphertext;
    el.dispatchEvent(new Event("input", { bubbles: true })); // required for React state
  },
  triggerSend: (el) => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  },
  getMessageListRoot: () => document.querySelector('[data-testid="message-list"]') ?? null,
  isMessageNode: (node) =>
    node instanceof Element && node.matches('[data-testid="message-bubble"]'),
  extractMessageText: (node) => node.textContent ?? "",
  replaceMessageText: (node, plaintext) => { node.textContent = `🔒 ${plaintext}`; },
};
```

Selectors must be verified against Bale web's live DOM before merging. Prefer `aria-label` and `data-testid` over generated class names. Document fragile selectors in `adapter-bale/README.md`.

### Testing Strategy

**Layer 1 — adapter-bale unit tests (vitest + jsdom)**
- Run against static HTML fixtures in `adapter-bale/test/fixtures/bale-chat.html`
- Never the live Bale site
- Test: composer found, text injection round-trips, `isMessageNode` filters correctly

**Layer 2 — extension-core unit tests (vitest)**
- Mock `chrome.runtime` and `crypto.subtle`
- Test the handshake state machine (IDLE → PENDING → ACTIVE)
- Test `KEY_CHANGE_DETECTED` on senderKeyId mismatch for known peer
- Test `NO_SESSION` error on encrypt before handshake

**Layer 3 — E2E tests (Playwright)**
- Local fixture page (`packages/build/test/fixture-page/index.html`) mimicking a Bale-like chat UI
- Two extension instances loaded side by side
- Scenarios: handshake round-trip, encrypted message, safety number match, key-change warning, malformed envelope → graceful "could not decrypt"

**Cross-platform conformance:**
- `docs/TEST_VECTORS.json` — machine-readable inputs/outputs for the full envelope encode/decode cycle
- Generated by `crypto-core` tests
- Future Android and iOS implementations run the same vectors to prove wire format compatibility

---

## Phase 3: Multi-Device Key Sync

### Zero-Knowledge QR Device Linking

The backend is a dumb encrypted blob relay. It never sees plaintext keys.

```
New device:                             Existing device:
  Generate temp RSA-OAEP keypair          Scan QR code
  (ephemeral, extractable)                Read tempPubKeyJwk + linkId

  Show QR:                                Export identity keypair
    { tempPubKeyJwk, linkId }             Collect all session keys

                                          Encrypt bundle:
                                            RSA-OAEP(tempPubKey, {
                                              identityPrivKeyJwk,
                                              identityPubKeyJwk,
                                              sessions: [...]
                                            })

                                          PUT /sync/{linkId}   ← encrypted blob
                                            (TTL: 5 minutes)

  Poll GET /sync/{linkId}
  Decrypt with temp private key
  Import identity keypair
  Import session keys

  DELETE /sync/{linkId}
```

Both devices now share the same identity. Same fingerprint. Same sessions. Contacts do not need to re-verify.

### Backend Relay API

Three endpoints. No auth. No user accounts. No content logging. Rate-limited by IP.

```
PUT    /sync/{linkId}    store encrypted blob (TTL 5min, max 64KB)
GET    /sync/{linkId}    retrieve blob (auto-deletes after read)
DELETE /sync/{linkId}    explicit cleanup
```

The relay can be closed-source. The protocol spec (this document + `CRYPTO_DESIGN.md`) fully describes what the relay must and must not do. A user can verify server behavior by reading the open-source client and confirming the client never transmits plaintext.

---

## Phase 4: Group Chat + Eitaa / Sorush+ Adapters

### Group Chat: Sender Keys Protocol

Signal's Sender Keys model — efficient (one ciphertext per message regardless of group size), forward-secret per-sender, and compatible with the existing wire format via new `msgType` values.

**New msgType values:**
- `5 = SENDER_KEY_DISTRIBUTION` — distributes a sender's chain key to one group member, delivered pairwise over existing 1:1 sessions
- `6 = GROUP_DATA` — group message encrypted under the sender's current chain key

**Group identity:** a hash of the platform's group room identifier, extracted by the adapter. The adapter API gains one new optional method:

```typescript
getGroupId?(): string | null;  // null = not in a group context
```

**Key design constraints:**
- **Member joins:** new member receives sender keys from all existing members (pairwise, using 1:1 sessions). They cannot decrypt history — forward secrecy is preserved.
- **Member leaves:** all remaining members rotate their sender chain keys and re-distribute. Without this, the departed member could still decrypt future messages — a critical concern for the threat model.
- **Group membership source:** the adapter reads the member list from the platform DOM. waxseal cannot control who the platform adds or removes; it can only react to membership changes.

### Eitaa + Sorush+ Adapters

Phase 4 adds `adapter-eitaa` and `adapter-sorush` following the same pattern as `adapter-bale`. Both require:
- DOM inspection of their respective web interfaces
- Static HTML fixtures checked into `test/fixtures/`
- The same three test layers as the Bale adapter

---

## Phase 5: Double Ratchet (Per-Message Forward Secrecy)

The wire format's `version` and `msgType` fields exist specifically for this upgrade. Phase 5 adds new `msgType` values for ECDH ratchet steps (using P-256 via SubtleCrypto, since X25519 browser support is inconsistent). Existing Phase 2 sessions continue to work under version 1 semantics. New sessions negotiate the ratchet via a version flag in the handshake.

This phase does not change the adapter interface or the extension shell — it is purely a `crypto-core` and `extension-core` background upgrade.

---

## Phases 6 & 7: Android and iOS

The wire format is the open standard. Android and iOS implementations must pass `TEST_VECTORS.json` conformance before any cross-platform session is considered valid.

**Android (Phase 6):**
- Kotlin implementation of `CRYPTO_DESIGN.md` using Android Keystore + `javax.crypto`
- Integration mechanism: Android accessibility service or custom IME (keyboard extension) that intercepts text fields system-wide before the messaging app receives them
- Same QR device-linking protocol — Android scans the QR shown by the browser extension

**iOS (Phase 7):**
- Swift implementation using CryptoKit + `SecKey`
- Integration mechanism: Share Sheet extension or custom keyboard extension
- Same QR device-linking protocol

**Cross-platform session compatibility:** An AES-256-GCM session key established on the browser extension decrypts a message sent from Android, because the wire format is identical. `senderKeyId` in the envelope identifies the sending device; the session key itself is shared across devices after QR linking.

---

## Transparency Deliverables by Phase

| Phase | What is made public |
|---|---|
| 2 | Open-source repo + reproducible Chrome/Firefox build + `CRYPTO_DESIGN.md` |
| 3 | Sync protocol spec added to `CRYPTO_DESIGN.md` + relay API documented |
| 4 | Group chat protocol spec + adapter HTML fixtures public |
| 5 | Double Ratchet upgrade spec |
| 6 | Kotlin implementation auditable against TypeScript spec + `TEST_VECTORS.json` |
| 7 | Swift implementation auditable against same spec + test vectors |

The backend remains closed-source at every phase. The transparency guarantee never depends on it.
