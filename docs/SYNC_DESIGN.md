# Multi-Device Sync Design

This document is the source of truth for waxseal's Phase 3 multi-device key
synchronisation. Code in `packages/crypto-core/src/sync.ts` (new) and
updates to `packages/crypto-core/src/keys.ts` must match this document; if
they diverge, update both in the same PR.

Read `docs/CRYPTO_DESIGN.md` first — this document extends it.

---

## Goals and non-goals

**Goals:**
- A user who installs waxseal on a second device (browser extension on a
  different machine, or a future Android/iOS client) continues their
  conversations seamlessly — same identity fingerprint, same session keys.
- The backend learns nothing that helps it decrypt messages or private keys,
  even under compulsion.
- The sync mechanism is formally specified here so third-party auditors can
  verify the client without reading the server code.

**Non-goals:**
- Message history sync (messages live on the messaging platform's servers;
  waxseal only syncs keys).
- Real-time "last seen" or presence metadata.
- Forward secrecy across device link events (a compromised key bundle
  compromises all sessions active at export time; this is documented plainly
  and mitigated by session rotation after linking).

---

## Threat model additions (extends SECURITY.md)

**Defended against (new in Phase 3):**
- A backend operator reading the encrypted key bundle stored on the server.
- An attacker who obtains the server's OPAQUE credential database performing
  offline dictionary attacks on user passwords (OPAQUE property: offline
  attacks require compromising both the server record and knowledge of the
  password — the OPRF evaluation cannot be replicated offline).
- A passive observer of the backend relay seeing the key bundle in transit.

**Explicitly out of scope:**
- An attacker who has already compromised the user's primary device (they
  can read keys from memory, same as any client-side encryption tool).
- A user who chooses a weak sync password is only weakly protected; the
  OPAQUE+Argon2 KDF chain raises the cost of a brute-force attack
  significantly but cannot compensate for a guessable password.
- Session keys generated after a device-link event are not retroactively
  available on older linked devices — only keys active at export time are
  synced. New sessions auto-establish on each device independently via the
  existing TOFU handshake.

---

## Architecture overview

Phase 3 introduces two paths to sync an identity keypair and active session
keys across devices. They are independent and complementary:

```
Path A — OPAQUE account (persistent, any device at any time)
  User creates a waxseal account (email + OPAQUE credential).
  Their key bundle is encrypted with a key derived from the OPAQUE
  export_key (never transmitted to server) and stored on the backend.
  Any device: complete OPAQUE login → derive bundle key → download and
  decrypt bundle locally.

Path B — QR device linking (ephemeral, requires primary device online)
  New device generates an ephemeral P-256 keypair, shows QR.
  Primary device scans, seals the bundle under a fresh ECDHE shared secret,
  posts to a short-lived relay endpoint (TTL 5 min).
  New device retrieves and decrypts. No password required.
```

The recommended UX: use Path B (QR) when a linked device is nearby. Fall
back to Path A (OPAQUE account) when linking a remote device or recovering
after total device loss.

---

## OPAQUE authentication (RFC 9807)

### Why OPAQUE over PBKDF2+bcrypt

Standard password hashing (PBKDF2, bcrypt, Argon2 server-side) stores a
hash on the server. If the server's credential database is exfiltrated, an
attacker can run offline dictionary attacks at their own pace.

OPAQUE (RFC 9807, July 2025) is an augmented PAKE that eliminates this
property. The server stores an _OPAQUE record_ — a credential envelope
produced by an Oblivious Pseudo-Random Function (OPRF) evaluation. Offline
attacks against the record require knowledge of the password AND the
server's OPRF key simultaneously. Neither alone is sufficient.

OPAQUE also produces a client-side `export_key` (64 bytes): a deterministic
secret derived from the OPRF output that is never transmitted to the server
and is not derivable from the server's record. This is the foundation of
our bundle encryption scheme.

### Implementation

Use `@serenity-kit/opaque-p256` (WASM, browser-compatible). This variant
uses the P-256 OPRF group and the Ristretto255-over-P-256 construction,
matching the SubtleCrypto P-256 keys already used throughout crypto-core.

```
Registration (once, on account creation):
  client_reg_request = OPAQUE-CreateRegistrationRequest(password)
  → POST /auth/register/start  { opaque_request }
  ← server_reg_response (OPRF evaluation)
  (client_reg_record, export_key) = OPAQUE-FinalizeRegistration(
    password, server_reg_response
  )
  → POST /auth/register/finish  { opaque_record }
  (export_key is used locally — see "Bundle encryption" below)

Login (on each new device):
  client_login_request = OPAQUE-CreateLoginRequest(password)
  → POST /auth/login/start  { opaque_request }
  ← server_login_response (OPRF evaluation + server credential proof)
  (session_token, export_key) = OPAQUE-FinalizeLogin(
    password, server_login_response
  )
  (If FinalizeLogin fails, the password is wrong — abort.)
  (export_key is identical to the one produced at registration — deterministic.)
```

The backend stores the OPAQUE record and issues a JWT session token on
successful login. It never sees the password or the `export_key`.

---

## Bundle encryption (Path A — persistent storage)

### Key derivation chain

```
export_key  (64 bytes, from OPAQUE FinalizeLogin/FinalizeRegistration)
     │
     ▼
bundle_salt  (32 random bytes, generated once at registration, stored
              alongside the encrypted blob — public, per-user)
     │
     ▼
HKDF-SHA-256(ikm=export_key, salt=bundle_salt, info="waxseal-bundle-enc-v1")
     │
     ▼
bundle_enc_key  (32 bytes, AES-256-GCM key — never leaves the client)
```

HKDF is used with a domain-separation `info` string so the same `export_key`
can safely derive multiple independent keys in the future (e.g., a separate
key for metadata encryption).

### Encryption

```
iv = CSPRNG(12 bytes)
aad = UTF-8("waxseal-bundle-v1")      // authenticated but not encrypted
ciphertext = AES-256-GCM.encrypt(bundle_enc_key, iv, plaintext_bundle, aad)
stored_blob = iv || ciphertext          // 12 + len(plaintext) + 16 bytes
```

### Bundle plaintext format

```json
{
  "version": 1,
  "exportedAt": "2026-07-02T12:00:00Z",
  "identity": {
    "privateKeyJwk": { "kty":"RSA", "alg":"RSA-OAEP-256", ... },
    "publicKeyJwk":  { "kty":"RSA", "alg":"RSA-OAEP-256", ... }
  },
  "sessions": [
    {
      "peerFingerprint": "<hex SHA-256>",
      "sessionKeyId":    "<base64url 8 bytes>",
      "sessionKeyRaw":   "<base64url 32 bytes>",
      "state":           "ACTIVE"
    }
  ]
}
```

The bundle is serialised as UTF-8 JSON, then compressed with DEFLATE raw
(reduces size by ~50% for JWKs), then encrypted.

### Backend storage

```
PUT  /sync/bundle           store encrypted blob (replaces previous)
GET  /sync/bundle           retrieve current encrypted blob
```

Authenticated with the OPAQUE session JWT. The backend stores:
- `user_id`
- `opaque_record`
- `bundle_salt` (public per-user, needed for key derivation on login)
- `encrypted_blob` (opaque to the backend)
- `blob_updated_at`

The backend never stores or logs `export_key`, `bundle_enc_key`, or the
plaintext bundle.

### When to upload a new bundle

The client uploads a fresh encrypted bundle after:
1. First registration (after generating identity keypair).
2. A new outbound session is established with a peer.
3. A session key is rotated.
4. A new device is linked (Path B) — the primary device uploads to ensure
   the latest sessions are available to the new device on next login.

Uploads are async and best-effort — a failed upload does not block messaging.

---

## QR device linking (Path B — ephemeral ECDHE)

This path requires no password and leaves no persistent server state beyond
the 5-minute TTL relay slot. It mirrors Signal's "Synchronized Start"
provisioning mechanism (Signal blog, 2025).

### Protocol

```
Step 1 — New device:
  (d_priv, d_pub) = SubtleCrypto.generateKey("ECDH", P-256, extractable=true)
  link_id = CSPRNG(16 bytes)
  QR payload = base64url({ d_pub_jwk, link_id })
  [display QR code]

Step 2 — Primary device (scans QR):
  decode d_pub_jwk, link_id from QR
  (e_priv, e_pub) = SubtleCrypto.generateKey("ECDH", P-256, extractable=true)
  shared_secret = ECDH(e_priv, d_pub)          // 32 bytes
  transfer_key  = HKDF-SHA-256(
    ikm   = shared_secret,
    salt  = link_id,                            // domain-separates this exchange
    info  = "waxseal-device-link-v1",
    len   = 32
  )
  iv = CSPRNG(12 bytes)
  sealed = AES-256-GCM.encrypt(
    transfer_key, iv,
    DEFLATE(JSON(key_bundle)),
    aad = UTF-8("waxseal-device-link-v1")
  )
  PUT /link/{link_id}  { e_pub_jwk, iv, sealed }   (TTL: 5 min)

Step 3 — New device (polls):
  GET /link/{link_id}  → { e_pub_jwk, iv, sealed }
  shared_secret = ECDH(d_priv, e_pub)
  transfer_key  = HKDF-SHA-256(
    ikm   = shared_secret,
    salt  = link_id,
    info  = "waxseal-device-link-v1",
    len   = 32
  )
  key_bundle = JSON.parse(INFLATE(AES-256-GCM.decrypt(transfer_key, iv, sealed)))
  import identity keypair + sessions
  DELETE /link/{link_id}
  [linking complete]
```

`link_id` serves as both the relay slot address and the HKDF salt, binding
the derived `transfer_key` to this specific exchange and preventing
cross-session key reuse.

### Security properties

- **Forward secrecy of the transfer**: both `e_priv` and `d_priv` are
  ephemeral. Compromise of the primary device after linking does not expose
  the `transfer_key`.
- **No server knowledge**: the relay stores only `{ e_pub_jwk, iv, sealed }`.
  `e_pub` is a public key; the relay cannot compute `shared_secret` without
  `d_priv`, which only the new device holds.
- **Replay prevention**: the relay slot auto-deletes after first GET or after
  5 minutes, whichever is first. `link_id` is random 128 bits — guessing it
  is infeasible.
- **Binding to QR scan**: the HKDF salt `link_id` ensures that even if two
  link sessions ran concurrently, their transfer keys are independent.

### Relay API

```
PUT    /link/{link_id}   store sealed payload (auth: session JWT or anonymous)
GET    /link/{link_id}   retrieve payload (one-time read, auto-deletes)
DELETE /link/{link_id}   explicit early cleanup
```

No user account is required to use Path B — the QR flow works even before a
waxseal account is created. The relay is a dumb, public, TTL-keyed store.

---

## crypto-core changes

All new functions are added to `packages/crypto-core`. They compile against
the SubtleCrypto API and are tested with the same vitest setup as the rest
of crypto-core. No new runtime dependencies are introduced to crypto-core
itself — OPAQUE lives in a separate `packages/sync-auth` package (see below).

### `packages/crypto-core/src/keys.ts` (additions)

```typescript
// Existing function gains an optional parameter:
export async function generateIdentityKeyPair(
  options?: { extractable?: boolean }   // default: false (unchanged)
): Promise<CryptoKeyPair>

// Export/import — only callable when keypair was generated with extractable=true
export async function exportIdentityKeyPair(
  pair: CryptoKeyPair
): Promise<IdentityKeyJwk>

export async function importIdentityKeyPair(
  jwk: IdentityKeyJwk,
  options?: { extractable?: boolean }   // default: false
): Promise<CryptoKeyPair>

// Type alias
export interface IdentityKeyJwk {
  privateKeyJwk: JsonWebKey;
  publicKeyJwk:  JsonWebKey;
}
```

The `extractable: false` default is preserved. Phase 2 callers are unchanged.
The `NonExtractableKeyStore` in `extension-core` continues to pass
`extractable: false`. The `ExtractableKeyStore` introduced in Phase 3 passes
`extractable: true`.

### `packages/crypto-core/src/sync.ts` (new file)

```typescript
// ── Bundle types ──────────────────────────────────────────────────────────

export interface KeyBundle {
  version:    1;
  exportedAt: string;          // ISO 8601
  identity:   IdentityKeyJwk;
  sessions:   SyncedSession[];
}

export interface SyncedSession {
  peerFingerprint: string;     // hex SHA-256, 64 chars
  sessionKeyId:    string;     // base64url, 8 bytes
  sessionKeyRaw:   string;     // base64url, 32 bytes
  state:           "ACTIVE" | "PENDING";
}

// ── Bundle serialisation ──────────────────────────────────────────────────

export function serialiseBundle(bundle: KeyBundle): Uint8Array
export function deserialiseBundle(bytes: Uint8Array): KeyBundle
// serialise: JSON → UTF-8 → DEFLATE raw (CompressionStream "deflate-raw",
//            supported natively in Chrome 103+, Firefox 113+)
// deserialise: INFLATE → UTF-8 → JSON.parse + schema validate

// ── Path A: persistent bundle encryption ─────────────────────────────────

export async function deriveBundleKey(
  exportKey: Uint8Array,  // 64-byte OPAQUE export_key
  bundleSalt: Uint8Array  // 32-byte per-user salt (stored on server)
): Promise<CryptoKey>    // AES-256-GCM, non-extractable
// HKDF-SHA-256(ikm=exportKey, salt=bundleSalt, info="waxseal-bundle-enc-v1")

export async function encryptBundle(
  bundle: KeyBundle,
  bundleKey: CryptoKey
): Promise<Uint8Array>   // iv(12) || ciphertext+tag

export async function decryptBundle(
  blob: Uint8Array,
  bundleKey: CryptoKey
): Promise<KeyBundle>

// ── Path B: ephemeral ECDHE device linking ────────────────────────────────

export async function generateLinkingKeypair(): Promise<CryptoKeyPair>
// P-256 ECDH, extractable (needed for JWK export in QR payload)

export interface SealedBundle {
  ePubJwk: JsonWebKey;   // sender's ephemeral P-256 public key
  iv:      Uint8Array;   // 12 bytes
  sealed:  Uint8Array;   // AES-256-GCM ciphertext+tag
}

// Called by the primary device after scanning QR:
export async function sealBundleForDevice(
  bundle:             KeyBundle,
  recipientPubKeyJwk: JsonWebKey,  // d_pub from new device's QR
  linkId:             Uint8Array   // 16 bytes — used as HKDF salt
): Promise<SealedBundle>

// Called by the new device after receiving relay payload:
export async function unsealBundle(
  sealed:       SealedBundle,
  ourPrivateKey: CryptoKey,    // d_priv from step 1
  linkId:        Uint8Array
): Promise<KeyBundle>
```

### `packages/sync-auth/` (new package)

OPAQUE lives in a separate package to keep crypto-core free of WASM
dependencies. `sync-auth` wraps `@serenity-kit/opaque-p256`:

```typescript
// packages/sync-auth/src/index.ts

export async function startRegistration(password: string): Promise<{
  request:   Uint8Array;  // send to POST /auth/register/start
}>

export async function finalizeRegistration(
  password:       string,
  serverResponse: Uint8Array
): Promise<{
  record:    Uint8Array;  // send to POST /auth/register/finish
  exportKey: Uint8Array;  // 64 bytes — keep locally, derive bundle key
}>

export async function startLogin(password: string): Promise<{
  request:   Uint8Array;  // send to POST /auth/login/start
  state:     OpaqueLoginState;  // opaque, keep in memory
}>

export async function finalizeLogin(
  password:       string,
  state:          OpaqueLoginState,
  serverResponse: Uint8Array
): Promise<{
  sessionToken: string;   // JWT from server
  exportKey:    Uint8Array;  // 64 bytes — derive bundle key
}>
```

`exportKey` is never persisted to storage. It is held in memory for the
duration of the sync operation and then zeroed (or left for GC).

---

## Key storage upgrade (ExtractableKeyStore)

Phase 3 adds `ExtractableKeyStore` behind the existing `KeyStore` interface
in `extension-core/src/storage.ts`. No callers outside `storage.ts` change.

```typescript
// extension-core/src/storage.ts

class ExtractableKeyStore implements KeyStore {
  async loadIdentityKey(): Promise<CryptoKeyPair | null> {
    const jwk = await idb.get<IdentityKeyJwk>("identity");
    if (!jwk) return null;
    return importIdentityKeyPair(jwk, { extractable: true });
  }

  async saveIdentityKey(pair: CryptoKeyPair): Promise<void> {
    const jwk = await exportIdentityKeyPair(pair);
    await idb.put("identity", jwk);
  }
}
```

Keys are stored as JWK in IndexedDB (not raw bytes), serialised as JSON.
IndexedDB for the extension's own origin is not accessible from the host
page, and the JWK is not directly usable by code that does not also have
access to the extension's IndexedDB — but a compromised device bypasses
this. The threat model does not defend against a compromised device.

### Migration path for Phase 2 users

On first Phase 3 launch, if `NonExtractableKeyStore` has an identity key
and `ExtractableKeyStore` does not:

1. Warn the user: "Multi-device sync requires regenerating your identity key.
   Your contacts will need to re-verify your safety number."
2. Require explicit confirmation.
3. Generate a new extractable identity keypair.
4. The old non-extractable key is abandoned (it cannot be exported).
5. The user initiates new handshakes with their contacts on next conversation.

This is a one-time migration, documented plainly in the UI. It is the
expected and correct behaviour, not a bug.

---

## Session key availability across devices

Sessions established on device A before device B was linked are included in
the bundle exported at link time. However:

- **Sessions established after linking** are not automatically available on
  other devices. Each new session key must be re-synced by uploading a new
  bundle (Path A) or by the peer re-establishing a session with each device
  independently via the existing TOFU handshake.
- **Recommended UX**: after any new session is established, the extension
  silently re-uploads the encrypted bundle in the background (Path A). On
  next login, other devices download the latest bundle.
- For Path B (QR), the primary device should be prompted to upload a fresh
  bundle immediately after a new device is linked, to ensure the new device
  starts with the freshest session keys on first login.

This is weaker than Signal's per-device session model (where each device
gets its own session) but is simpler and sufficient for the waxseal threat
model. Signal's approach can be adopted in a future phase.

---

## Wire format extensions

No changes to the `⁉WAXSEAL1:` envelope format are required for Phase 3.
Sync is an out-of-band operation; it does not travel through the messaging
platform's chat channel.

---

## Known limitations (Phase 3)

- **No per-message key agreement**: all devices sharing an identity share
  the same session key. A compromised device can decrypt all messages in
  that session. Signal's per-device session model is the upgrade path.
- **No post-quantum security**: OPAQUE-P256 and ECDH-P256 are vulnerable to
  a sufficiently large quantum computer. The IETF draft for hybrid
  post-quantum PAKE (draft-vos-cfrg-pqpake) is tracked; migration is
  feasible because the bundle format is versioned.
- **Bundle freshness**: a device that has been offline for an extended period
  may have a stale bundle. Sessions rotated while it was offline will not
  decrypt older messages. This is intentional (forward secrecy property).

---

## References

- RFC 9807 — OPAQUE aPAKE: https://www.rfc-editor.org/rfc/rfc9807
- draft-vos-cfrg-pqpake — Hybrid Post-Quantum PAKE: https://datatracker.ietf.org/doc/draft-vos-cfrg-pqpake/
- RFC 9106 — Argon2 (for server-side password hashing): https://www.rfc-editor.org/rfc/rfc9106
- RFC 5869 — HKDF: https://www.rfc-editor.org/rfc/rfc5869
- Signal "A Synchronized Start for Linked Devices": https://signal.org/blog/a-synchronized-start-for-linked-devices/
- Multi-Device for Signal (Cremers et al., ePrint 2019/1363): https://eprint.iacr.org/2019/1363.pdf
- @serenity-kit/opaque-p256 (RFC 9807 browser implementation): https://www.npmjs.com/package/@serenity-kit/opaque-p256
