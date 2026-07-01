# crypto-core Test Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `packages/crypto-core` a real test suite (it currently has zero
tests despite CI running `pnpm test`), and fix a spec/implementation
divergence in the handshake wire format that was found while reading the
code.

**Architecture:** No production code changes are expected beyond what the
tests reveal is broken. One Vitest test file per existing source module
(`bytes`, `keys`, `fingerprint`, `envelope`, `session`, `handshake`),
exercising the public API exported from `src/index.ts`. Tests run under
Vitest's `node` environment, relying on Node 20's built-in global
`crypto.subtle` (confirmed present: `node -e "console.log(typeof
globalThis.crypto.subtle)"` → `object`).

**Tech Stack:** TypeScript (strict), Vitest 2.x, pnpm workspaces, Web Crypto
API (`crypto.subtle`). No new dependencies.

## Global Constraints

- TypeScript strict mode, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` (`tsconfig.base.json`) — all new code must satisfy these under `tsc --noEmit`.
- `packages/crypto-core/src/**` must stay pure: no DOM/`chrome`/`browser` globals (enforced by the `no-restricted-globals` ESLint override in `.eslintrc.cjs`). This plan does not touch `src/`, but keep it in mind if a test reveals a real bug requiring a source fix.
- Vitest environment for crypto-core is `node` (`packages/crypto-core/vitest.config.ts`) — do not change this to `jsdom` or similar; it's deliberate so crypto-core tests prove the code runs outside a browser context too.
- Package manager is pnpm `10.14.0` (root `package.json` `packageManager` field). Use `pnpm --filter @waxseal/crypto-core <script>` to scope commands to this package.
- `docs/CRYPTO_DESIGN.md` states: "Code in `packages/crypto-core` must match this document; if they diverge, update both in the same PR." Task 1 below fixes exactly this kind of divergence in `docs/WIRE_FORMAT.md`.
- No network access needed; all crypto operations are local `crypto.subtle` calls.

---

### Task 0: Install dependencies

**Files:** none (installs `node_modules` and generates `pnpm-lock.yaml`)

- [ ] **Step 1: Install workspace dependencies**

Run: `pnpm install`

Expected: completes successfully, creates `pnpm-lock.yaml` and
`node_modules/`. It's fine if pnpm prints warnings about the `packages/adapters/*`
and `e2e` glob patterns in `pnpm-workspace.yaml` matching no packages yet —
those are future phases, not part of this plan.

- [ ] **Step 2: Commit the lockfile**

```bash
git add pnpm-lock.yaml
git commit -m "chore: add pnpm lockfile"
```

---

### Task 1: Fix the HANDSHAKE_INIT/HANDSHAKE_RESPONSE payload spec in WIRE_FORMAT.md

**Files:**
- Modify: `docs/WIRE_FORMAT.md:20-28`

**Problem:** `docs/WIRE_FORMAT.md` currently describes the `HANDSHAKE_INIT`
and `HANDSHAKE_RESPONSE` payloads as raw, non-length-prefixed byte
concatenation (`nonce (16 bytes) || senderPublicKeyJwkBytes`). That's not
actually decodable as written — a JWK is variable-length JSON with no
delimiter, so there's no way to know where the nonce ends and the JWK bytes
begin without a length prefix the doc never specifies. The real
implementation in `packages/crypto-core/src/handshake.ts`
(`HandshakeInitPayload`/`HandshakeResponsePayload` + `packJsonPayload`) sidesteps
this by JSON-encoding the payload, which is self-delimiting. The doc must be
updated to match the code, per `CRYPTO_DESIGN.md`'s "code and docs must not
diverge" rule.

- [ ] **Step 1: Update the payload description**

In `docs/WIRE_FORMAT.md`, replace:

```markdown
- `HANDSHAKE_INIT`: `nonce (16 bytes) || senderPublicKeyJwkBytes`
- `HANDSHAKE_RESPONSE`: `echoedNonce (16 bytes) || RSA-OAEP(peerPubKey,
  rawSessionKeyBytes) || responderPublicKeyJwkBytes`
```

with:

```markdown
- `HANDSHAKE_INIT`: UTF-8 JSON `{ nonce: base64url(16 random bytes),
  publicKeyJwk: <sender's exported public key JWK> }`. JSON is used here
  (rather than raw concatenation) because the JWK is variable-length and
  needs self-delimiting framing to parse back out.
- `HANDSHAKE_RESPONSE`: UTF-8 JSON `{ echoedNonce: base64url(the 16-byte
  nonce from the INIT), wrappedSessionKey: base64url(RSA-OAEP(peerPubKey,
  rawSessionKeyBytes)), publicKeyJwk: <responder's exported public key
  JWK> }`.
```

- [ ] **Step 2: Verify the doc renders sensibly**

Run: `cat docs/WIRE_FORMAT.md`
Expected: the "Decoding rules" section below it (about rejecting short
envelopes, unknown versions, and not distinguishing decrypt-failure causes)
is unchanged and still reads correctly after the edit.

- [ ] **Step 3: Commit**

```bash
git add docs/WIRE_FORMAT.md
git commit -m "docs: fix HANDSHAKE payload spec to match JSON-encoded implementation"
```

---

### Task 2: Allow test files to be typechecked

**Files:**
- Modify: `packages/crypto-core/tsconfig.json`

**Problem:** `tsc --noEmit` (the `typecheck` script) only includes `src`, so
the test files this plan adds in Tasks 3-8 would never be typechecked by
`pnpm typecheck` / CI even though Vitest will happily run them. Fix this
first so every subsequent task's test file is actually type-checked.

- [ ] **Step 1: Add `test` to the tsconfig `include` array**

Current `packages/crypto-core/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022", "WebWorker"],
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

New:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022", "WebWorker"],
    "outDir": "dist"
  },
  "include": ["src", "test"]
}
```

(`rootDir: "src"` is dropped along with adding `test` to `include` — with
`test` and `src` as siblings, an explicit `rootDir` narrower than their
common parent would make `tsc` compute a mismatched output structure. Since
`main`/`types` in `package.json` point straight at `src/index.ts` and there is
no build step for this package yet, `outDir`/emitted-output shape is
currently inert; only `--noEmit` typechecking runs here.)

- [ ] **Step 2: Create an empty placeholder so the include path resolves**

Run: `mkdir -p packages/crypto-core/test`

(This directory gets populated with real test files in Task 3. `tsc` and
Vitest are both fine with running before any files exist there — this step
just confirms the directory is where you expect before adding content.)

- [ ] **Step 3: Commit**

```bash
git add packages/crypto-core/tsconfig.json
git commit -m "chore(crypto-core): include test/ in typecheck"
```

---

### Task 3: Tests for `bytes.ts`

**Files:**
- Create: `packages/crypto-core/test/bytes.test.ts`

**Interfaces:**
- Consumes: `base64UrlEncode`, `base64UrlDecode`, `Base64UrlDecodeError`, `utf8Encode`, `utf8Decode`, `concatBytes`, `bytesEqual` from `packages/crypto-core/src/bytes.ts` (all already implemented).

- [ ] **Step 1: Write the test file**

```ts
import { describe, expect, it } from "vitest";
import {
  base64UrlEncode,
  base64UrlDecode,
  Base64UrlDecodeError,
  utf8Encode,
  utf8Decode,
  concatBytes,
  bytesEqual,
} from "../src/bytes.js";

describe("base64UrlEncode / base64UrlDecode", () => {
  it("round-trips byte arrays of every padding length (0-5 bytes)", () => {
    for (let len = 0; len <= 5; len++) {
      const bytes = crypto.getRandomValues(new Uint8Array(len));
      const encoded = base64UrlEncode(bytes);
      expect(base64UrlDecode(encoded)).toEqual(bytes);
    }
  });

  it("matches a known vector", () => {
    const bytes = utf8Encode("Hello");
    expect(base64UrlEncode(bytes)).toBe("SGVsbG8");
  });

  it("decodes a known vector back to the original text", () => {
    const decoded = base64UrlDecode("SGVsbG8");
    expect(utf8Decode(decoded)).toBe("Hello");
  });

  it("produces no padding characters or internal whitespace", () => {
    const bytes = crypto.getRandomValues(new Uint8Array(37));
    const encoded = base64UrlEncode(bytes);
    expect(encoded).not.toMatch(/[=\s+/]/);
  });

  it("throws Base64UrlDecodeError on characters outside the alphabet", () => {
    expect(() => base64UrlDecode("not-valid-b64!")).toThrow(Base64UrlDecodeError);
    expect(() => base64UrlDecode("has spaces")).toThrow(Base64UrlDecodeError);
    expect(() => base64UrlDecode("has+plus")).toThrow(Base64UrlDecodeError);
  });
});

describe("utf8Encode / utf8Decode", () => {
  it("round-trips ASCII text", () => {
    expect(utf8Decode(utf8Encode("hello world"))).toBe("hello world");
  });

  it("round-trips multi-byte text (accents, emoji, non-Latin scripts)", () => {
    const text = "héllo 🔒 世界";
    expect(utf8Decode(utf8Encode(text))).toBe(text);
  });

  it("throws on malformed UTF-8 bytes (fatal decoding)", () => {
    const invalid = new Uint8Array([0x80]); // lone continuation byte, invalid on its own
    expect(() => utf8Decode(invalid)).toThrow();
  });
});

describe("concatBytes", () => {
  it("concatenates multiple chunks in order", () => {
    const result = concatBytes(new Uint8Array([1, 2]), new Uint8Array([3]), new Uint8Array([4, 5]));
    expect(result).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
  });

  it("handles empty and zero chunks", () => {
    expect(concatBytes()).toEqual(new Uint8Array(0));
    expect(concatBytes(new Uint8Array(0), new Uint8Array([9]))).toEqual(new Uint8Array([9]));
  });
});

describe("bytesEqual", () => {
  it("returns true for identical content", () => {
    expect(bytesEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true);
  });

  it("returns false for different lengths", () => {
    expect(bytesEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3]))).toBe(false);
  });

  it("returns false for same length but different content", () => {
    expect(bytesEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(false);
  });

  it("returns true for two empty arrays", () => {
    expect(bytesEqual(new Uint8Array(0), new Uint8Array(0))).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `pnpm --filter @waxseal/crypto-core test -- bytes.test.ts`
Expected: all tests PASS (this module has no known issues from code review).

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @waxseal/crypto-core typecheck`
Expected: exits 0, no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/crypto-core/test/bytes.test.ts
git commit -m "test(crypto-core): add bytes.ts coverage"
```

---

### Task 4: Tests for `keys.ts`

**Files:**
- Create: `packages/crypto-core/test/keys.test.ts`

**Interfaces:**
- Consumes: `generateIdentityKeyPair`, `exportPublicKeyJwk`, `importPublicKeyJwk`, `exportPrivateKeyJwk`, `importPrivateKeyJwk` from `packages/crypto-core/src/keys.ts`.

- [ ] **Step 1: Write the test file**

```ts
import { describe, expect, it } from "vitest";
import {
  generateIdentityKeyPair,
  exportPublicKeyJwk,
  importPublicKeyJwk,
  exportPrivateKeyJwk,
  importPrivateKeyJwk,
} from "../src/keys.js";

describe("generateIdentityKeyPair", () => {
  it("generates an extractable keypair by default", async () => {
    const { publicKey, privateKey } = await generateIdentityKeyPair();
    expect(publicKey.extractable).toBe(true);
    expect(privateKey.extractable).toBe(true);
    expect(publicKey.type).toBe("public");
    expect(privateKey.type).toBe("private");
  });

  it("respects extractable=false for both keys in the pair", async () => {
    const { privateKey } = await generateIdentityKeyPair(false);
    expect(privateKey.extractable).toBe(false);
    await expect(exportPrivateKeyJwk(privateKey)).rejects.toThrow();
  });
});

describe("public key JWK export/import", () => {
  it("round-trips a public key through JWK", async () => {
    const { publicKey } = await generateIdentityKeyPair();
    const jwk = await exportPublicKeyJwk(publicKey);
    expect(jwk.kty).toBe("RSA");
    const imported = await importPublicKeyJwk(jwk);
    expect(imported.type).toBe("public");
    expect(imported.usages).toContain("wrapKey");
  });
});

describe("private key JWK export/import", () => {
  it("round-trips an extractable private key through JWK", async () => {
    const { privateKey } = await generateIdentityKeyPair(true);
    const jwk = await exportPrivateKeyJwk(privateKey);
    expect(jwk.kty).toBe("RSA");
    const imported = await importPrivateKeyJwk(jwk, true);
    expect(imported.type).toBe("private");
    expect(imported.extractable).toBe(true);
  });

  it("imports as non-extractable by default", async () => {
    const { privateKey } = await generateIdentityKeyPair(true);
    const jwk = await exportPrivateKeyJwk(privateKey);
    const imported = await importPrivateKeyJwk(jwk);
    expect(imported.extractable).toBe(false);
    await expect(exportPrivateKeyJwk(imported)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `pnpm --filter @waxseal/crypto-core test -- keys.test.ts`
Expected: all tests PASS.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @waxseal/crypto-core typecheck`
Expected: exits 0, no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/crypto-core/test/keys.test.ts
git commit -m "test(crypto-core): add keys.ts coverage"
```

---

### Task 5: Tests for `fingerprint.ts`

**Files:**
- Create: `packages/crypto-core/test/fingerprint.test.ts`

**Interfaces:**
- Consumes: `fingerprintPublicKey`, `shortKeyId`, `formatFingerprint`, `combinedSafetyNumber` from `packages/crypto-core/src/fingerprint.ts`; `generateIdentityKeyPair`, `exportPublicKeyJwk` from `packages/crypto-core/src/keys.ts`.

- [ ] **Step 1: Write the test file**

```ts
import { describe, expect, it } from "vitest";
import { generateIdentityKeyPair, exportPublicKeyJwk } from "../src/keys.js";
import {
  fingerprintPublicKey,
  shortKeyId,
  formatFingerprint,
  combinedSafetyNumber,
} from "../src/fingerprint.js";

describe("fingerprintPublicKey", () => {
  it("is deterministic for the same JWK", async () => {
    const { publicKey } = await generateIdentityKeyPair();
    const jwk = await exportPublicKeyJwk(publicKey);
    const a = await fingerprintPublicKey(jwk);
    const b = await fingerprintPublicKey(jwk);
    expect(a).toEqual(b);
  });

  it("is independent of JWK property ordering", async () => {
    const jwkA = { kty: "RSA", n: "abc", e: "AQAB" } as JsonWebKey;
    const jwkB = { e: "AQAB", n: "abc", kty: "RSA" } as JsonWebKey;
    expect(await fingerprintPublicKey(jwkA)).toEqual(await fingerprintPublicKey(jwkB));
  });

  it("differs for different keys", async () => {
    const { publicKey: pubA } = await generateIdentityKeyPair();
    const { publicKey: pubB } = await generateIdentityKeyPair();
    const fpA = await fingerprintPublicKey(await exportPublicKeyJwk(pubA));
    const fpB = await fingerprintPublicKey(await exportPublicKeyJwk(pubB));
    expect(fpA).not.toEqual(fpB);
  });

  it("produces a 32-byte SHA-256 digest", async () => {
    const { publicKey } = await generateIdentityKeyPair();
    const fp = await fingerprintPublicKey(await exportPublicKeyJwk(publicKey));
    expect(fp.length).toBe(32);
  });
});

describe("shortKeyId", () => {
  it("is the first 8 bytes of the full fingerprint", async () => {
    const { publicKey } = await generateIdentityKeyPair();
    const jwk = await exportPublicKeyJwk(publicKey);
    const full = await fingerprintPublicKey(jwk);
    const short = await shortKeyId(jwk);
    expect(short).toEqual(full.slice(0, 8));
  });
});

describe("formatFingerprint", () => {
  it("formats an all-zero fingerprint as sixteen zero-groups", () => {
    const zero = new Uint8Array(32);
    expect(formatFingerprint(zero)).toBe(Array(16).fill("00000").join(" "));
  });

  it("respects a custom groupSize for the digit chunking", () => {
    const zero = new Uint8Array(32);
    const formatted = formatFingerprint(zero, 10);
    expect(formatted.split(" ").every((chunk) => chunk.length <= 10)).toBe(true);
  });
});

describe("combinedSafetyNumber", () => {
  it("is identical regardless of argument order", async () => {
    const { publicKey: pubA } = await generateIdentityKeyPair();
    const { publicKey: pubB } = await generateIdentityKeyPair();
    const fpA = await fingerprintPublicKey(await exportPublicKeyJwk(pubA));
    const fpB = await fingerprintPublicKey(await exportPublicKeyJwk(pubB));
    expect(combinedSafetyNumber(fpA, fpB)).toBe(combinedSafetyNumber(fpB, fpA));
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `pnpm --filter @waxseal/crypto-core test -- fingerprint.test.ts`
Expected: all tests PASS.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @waxseal/crypto-core typecheck`
Expected: exits 0, no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/crypto-core/test/fingerprint.test.ts
git commit -m "test(crypto-core): add fingerprint.ts coverage"
```

---

### Task 6: Tests for `envelope.ts`

**Files:**
- Create: `packages/crypto-core/test/envelope.test.ts`

**Interfaces:**
- Consumes: `MARKER`, `WIRE_VERSION`, `MsgType`, `EnvelopeDecodeError`, `encodeEnvelope`, `decodeEnvelope`, `containsEnvelopeMarker`, `findEnvelopeToken` from `packages/crypto-core/src/envelope.ts`; `base64UrlEncode` from `packages/crypto-core/src/bytes.ts`.

- [ ] **Step 1: Write the test file**

```ts
import { describe, expect, it } from "vitest";
import { base64UrlEncode } from "../src/bytes.js";
import {
  MARKER,
  WIRE_VERSION,
  MsgType,
  EnvelopeDecodeError,
  encodeEnvelope,
  decodeEnvelope,
  containsEnvelopeMarker,
  findEnvelopeToken,
} from "../src/envelope.js";

function randomBytes(len: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(len));
}

/** Fixed-header length per docs/WIRE_FORMAT.md: version(1) + senderKeyId(8) + sessionKeyId(8) + msgType(1) + iv(12). */
const FIXED_HEADER_LEN = 1 + 8 + 8 + 1 + 12;

/** Builds a syntactically-valid-length raw envelope by hand, bypassing encodeEnvelope's
 *  own validation, so decodeEnvelope's own field-level checks (version, msgType) can be
 *  exercised directly. */
function buildRawToken(opts: { version?: number; msgType?: number }): string {
  const header = new Uint8Array(FIXED_HEADER_LEN);
  header[0] = opts.version ?? WIRE_VERSION;
  header.set(randomBytes(8), 1);
  header.set(randomBytes(8), 9);
  header[17] = opts.msgType ?? MsgType.DATA;
  header.set(randomBytes(12), 18);
  return MARKER + base64UrlEncode(header);
}

describe("encodeEnvelope / decodeEnvelope", () => {
  it("round-trips all fields for a DATA envelope", () => {
    const fields = {
      senderKeyId: randomBytes(8),
      sessionKeyId: randomBytes(8),
      msgType: MsgType.DATA,
      iv: randomBytes(12),
      payload: randomBytes(40),
    };
    const token = encodeEnvelope(fields);
    expect(token.startsWith(MARKER)).toBe(true);
    const decoded = decodeEnvelope(token);
    expect(decoded.version).toBe(WIRE_VERSION);
    expect(decoded.senderKeyId).toEqual(fields.senderKeyId);
    expect(decoded.sessionKeyId).toEqual(fields.sessionKeyId);
    expect(decoded.msgType).toBe(fields.msgType);
    expect(decoded.iv).toEqual(fields.iv);
    expect(decoded.payload).toEqual(fields.payload);
  });

  it("round-trips an empty payload", () => {
    const fields = {
      senderKeyId: randomBytes(8),
      sessionKeyId: new Uint8Array(8),
      msgType: MsgType.SESSION_KEY_ACK,
      iv: randomBytes(12),
      payload: new Uint8Array(0),
    };
    const decoded = decodeEnvelope(encodeEnvelope(fields));
    expect(decoded.payload).toEqual(new Uint8Array(0));
  });

  it("throws EnvelopeDecodeError when senderKeyId has the wrong length", () => {
    const fields = {
      senderKeyId: randomBytes(7),
      sessionKeyId: randomBytes(8),
      msgType: MsgType.DATA,
      iv: randomBytes(12),
      payload: randomBytes(4),
    };
    expect(() => encodeEnvelope(fields)).toThrow(EnvelopeDecodeError);
  });

  it("throws EnvelopeDecodeError when sessionKeyId has the wrong length", () => {
    const fields = {
      senderKeyId: randomBytes(8),
      sessionKeyId: randomBytes(9),
      msgType: MsgType.DATA,
      iv: randomBytes(12),
      payload: randomBytes(4),
    };
    expect(() => encodeEnvelope(fields)).toThrow(EnvelopeDecodeError);
  });

  it("throws EnvelopeDecodeError when iv has the wrong length", () => {
    const fields = {
      senderKeyId: randomBytes(8),
      sessionKeyId: randomBytes(8),
      msgType: MsgType.DATA,
      iv: randomBytes(11),
      payload: randomBytes(4),
    };
    expect(() => encodeEnvelope(fields)).toThrow(EnvelopeDecodeError);
  });
});

describe("decodeEnvelope failure modes", () => {
  it("rejects a token missing the marker prefix", () => {
    expect(() => decodeEnvelope("not-a-waxseal-token")).toThrow(EnvelopeDecodeError);
  });

  it("rejects invalid base64url after the marker", () => {
    expect(() => decodeEnvelope(MARKER + "not valid!")).toThrow(EnvelopeDecodeError);
  });

  it("rejects an envelope shorter than the fixed header", () => {
    const short = MARKER + base64UrlEncode(randomBytes(5));
    expect(() => decodeEnvelope(short)).toThrow(EnvelopeDecodeError);
  });

  it("rejects an unsupported wire version", () => {
    expect(() => decodeEnvelope(buildRawToken({ version: 99 }))).toThrow(EnvelopeDecodeError);
  });

  it("rejects an unknown msgType byte", () => {
    expect(() => decodeEnvelope(buildRawToken({ msgType: 255 }))).toThrow(EnvelopeDecodeError);
  });
});

describe("containsEnvelopeMarker", () => {
  it("detects the marker anywhere in a string", () => {
    expect(containsEnvelopeMarker(`hey ${MARKER}abc123 there`)).toBe(true);
    expect(containsEnvelopeMarker("no marker here")).toBe(false);
  });
});

describe("findEnvelopeToken", () => {
  it("extracts the token from surrounding text", () => {
    const fields = {
      senderKeyId: randomBytes(8),
      sessionKeyId: randomBytes(8),
      msgType: MsgType.DATA,
      iv: randomBytes(12),
      payload: randomBytes(4),
    };
    const token = encodeEnvelope(fields);
    const wrapped = `hey check this out: ${token}!! cool right?`;
    expect(findEnvelopeToken(wrapped)).toBe(token);
  });

  it("returns null when no marker is present", () => {
    expect(findEnvelopeToken("just a normal chat message")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `pnpm --filter @waxseal/crypto-core test -- envelope.test.ts`
Expected: all tests PASS.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @waxseal/crypto-core typecheck`
Expected: exits 0, no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/crypto-core/test/envelope.test.ts
git commit -m "test(crypto-core): add envelope.ts coverage"
```

---

### Task 7: Tests for `session.ts`

**Files:**
- Create: `packages/crypto-core/test/session.test.ts`

**Interfaces:**
- Consumes: `generateSessionKey`, `wrapSessionKey`, `unwrapSessionKey`, `encryptMessage`, `decryptMessage`, `DecryptError` from `packages/crypto-core/src/session.ts`; `generateIdentityKeyPair` from `packages/crypto-core/src/keys.ts`; `utf8Encode`, `utf8Decode` from `packages/crypto-core/src/bytes.ts`.

- [ ] **Step 1: Write the test file**

```ts
import { describe, expect, it } from "vitest";
import { generateIdentityKeyPair } from "../src/keys.js";
import {
  generateSessionKey,
  wrapSessionKey,
  unwrapSessionKey,
  encryptMessage,
  decryptMessage,
  DecryptError,
} from "../src/session.js";
import { utf8Encode, utf8Decode } from "../src/bytes.js";

describe("generateSessionKey", () => {
  it("generates an extractable AES-256-GCM key", async () => {
    const key = await generateSessionKey();
    expect(key.algorithm.name).toBe("AES-GCM");
    expect((key.algorithm as AesKeyAlgorithm).length).toBe(256);
    expect(key.extractable).toBe(true);
  });
});

describe("wrapSessionKey / unwrapSessionKey", () => {
  it("round-trips a session key through RSA-OAEP wrapping", async () => {
    const { publicKey, privateKey } = await generateIdentityKeyPair();
    const sessionKey = await generateSessionKey();
    const wrapped = await wrapSessionKey(sessionKey, publicKey);
    const unwrapped = await unwrapSessionKey(wrapped, privateKey);

    const { iv, ciphertext } = await encryptMessage(sessionKey, utf8Encode("secret message"));
    const decrypted = await decryptMessage(unwrapped, iv, ciphertext);
    expect(utf8Decode(decrypted)).toBe("secret message");
  });

  it("unwraps as non-extractable by default", async () => {
    const { publicKey, privateKey } = await generateIdentityKeyPair();
    const sessionKey = await generateSessionKey();
    const wrapped = await wrapSessionKey(sessionKey, publicKey);
    const unwrapped = await unwrapSessionKey(wrapped, privateKey);
    expect(unwrapped.extractable).toBe(false);
  });
});

describe("encryptMessage / decryptMessage", () => {
  it("round-trips plaintext of varying sizes, including empty", async () => {
    const key = await generateSessionKey();
    for (const text of ["", "a", "hello world", "x".repeat(5000)]) {
      const { iv, ciphertext } = await encryptMessage(key, utf8Encode(text));
      const decrypted = await decryptMessage(key, iv, ciphertext);
      expect(utf8Decode(decrypted)).toBe(text);
    }
  });

  it("uses a fresh IV on every call", async () => {
    const key = await generateSessionKey();
    const a = await encryptMessage(key, utf8Encode("same plaintext"));
    const b = await encryptMessage(key, utf8Encode("same plaintext"));
    expect(a.iv).not.toEqual(b.iv);
  });

  it("throws DecryptError when decrypting with the wrong key", async () => {
    const keyA = await generateSessionKey();
    const keyB = await generateSessionKey();
    const { iv, ciphertext } = await encryptMessage(keyA, utf8Encode("secret"));
    await expect(decryptMessage(keyB, iv, ciphertext)).rejects.toThrow(DecryptError);
  });

  it("throws DecryptError when the ciphertext is tampered with", async () => {
    const key = await generateSessionKey();
    const { iv, ciphertext } = await encryptMessage(key, utf8Encode("secret"));
    const tampered = new Uint8Array(ciphertext);
    tampered[0] = tampered[0]! ^ 0xff;
    await expect(decryptMessage(key, iv, tampered)).rejects.toThrow(DecryptError);
  });

  it("throws DecryptError when the IV is wrong", async () => {
    const key = await generateSessionKey();
    const { ciphertext } = await encryptMessage(key, utf8Encode("secret"));
    const wrongIv = crypto.getRandomValues(new Uint8Array(12));
    await expect(decryptMessage(key, wrongIv, ciphertext)).rejects.toThrow(DecryptError);
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `pnpm --filter @waxseal/crypto-core test -- session.test.ts`
Expected: all tests PASS.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @waxseal/crypto-core typecheck`
Expected: exits 0, no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/crypto-core/test/session.test.ts
git commit -m "test(crypto-core): add session.ts coverage"
```

---

### Task 8: Tests for `handshake.ts`

**Files:**
- Create: `packages/crypto-core/test/handshake.test.ts`

**Interfaces:**
- Consumes: `HandshakeInitiator`, `HandshakeResponder`, `HandshakeError`, `createSessionKeyAck`, `detectKeyChange` from `packages/crypto-core/src/handshake.ts`; `MsgType`, `EnvelopeFields`, `EncodableEnvelope` from `packages/crypto-core/src/envelope.ts`; `generateIdentityKeyPair`, `exportPublicKeyJwk` from `packages/crypto-core/src/keys.ts`; `shortKeyId` from `packages/crypto-core/src/fingerprint.ts`; `encryptMessage`, `decryptMessage` from `packages/crypto-core/src/session.ts`; `utf8Encode`, `utf8Decode` from `packages/crypto-core/src/bytes.ts`.

- [ ] **Step 1: Write the test file**

```ts
import { describe, expect, it } from "vitest";
import { generateIdentityKeyPair, exportPublicKeyJwk } from "../src/keys.js";
import { shortKeyId } from "../src/fingerprint.js";
import { encryptMessage, decryptMessage } from "../src/session.js";
import { utf8Encode, utf8Decode } from "../src/bytes.js";
import { MsgType, type EnvelopeFields, type EncodableEnvelope } from "../src/envelope.js";
import {
  HandshakeInitiator,
  HandshakeResponder,
  HandshakeError,
  createSessionKeyAck,
  detectKeyChange,
} from "../src/handshake.js";

/** Stands in for what a real transport would attach: the fixed WIRE_VERSION byte
 *  is the only field EncodableEnvelope omits relative to EnvelopeFields. */
function toFields(encodable: EncodableEnvelope): EnvelopeFields {
  return { version: 1, ...encodable };
}

describe("HandshakeInitiator / HandshakeResponder", () => {
  it("completes a full handshake and derives a shared, working session key", async () => {
    const alice = await generateIdentityKeyPair();
    const bob = await generateIdentityKeyPair();

    const initiator = new HandshakeInitiator(alice);
    const responder = new HandshakeResponder(bob);

    const initEnvelope = toFields(await initiator.createInit());
    const { responseFields, sessionKey: bobSessionKey } = await responder.handleInit(initEnvelope);

    const { sessionKey: aliceSessionKey } = await initiator.handleResponse(toFields(responseFields));

    const { iv, ciphertext } = await encryptMessage(aliceSessionKey, utf8Encode("hi bob"));
    const decrypted = await decryptMessage(bobSessionKey, iv, ciphertext);
    expect(utf8Decode(decrypted)).toBe("hi bob");
  });

  it("rejects starting a second init on the same initiator instance", async () => {
    const alice = await generateIdentityKeyPair();
    const initiator = new HandshakeInitiator(alice);
    await initiator.createInit();
    await expect(initiator.createInit()).rejects.toThrow(HandshakeError);
  });

  it("rejects a response with a mismatched nonce", async () => {
    const alice = await generateIdentityKeyPair();
    const bob = await generateIdentityKeyPair();
    const otherAttempt = await generateIdentityKeyPair();

    const initiator = new HandshakeInitiator(alice);
    await initiator.createInit();

    // A response generated for a *different* init (different nonce) must be rejected.
    const rogueInitiator = new HandshakeInitiator(otherAttempt);
    const rogueInit = toFields(await rogueInitiator.createInit());
    const responder = new HandshakeResponder(bob);
    const { responseFields } = await responder.handleInit(rogueInit);

    await expect(initiator.handleResponse(toFields(responseFields))).rejects.toThrow(HandshakeError);
  });

  it("rejects handling a response when no handshake is in progress", async () => {
    const alice = await generateIdentityKeyPair();
    const bob = await generateIdentityKeyPair();
    const initiator = new HandshakeInitiator(alice); // never calls createInit()

    const helperInitiator = new HandshakeInitiator(alice);
    const init = toFields(await helperInitiator.createInit());
    const responder = new HandshakeResponder(bob);
    const { responseFields } = await responder.handleInit(init);

    await expect(initiator.handleResponse(toFields(responseFields))).rejects.toThrow(HandshakeError);
  });

  it("rejects replaying an already-consumed response", async () => {
    const alice = await generateIdentityKeyPair();
    const bob = await generateIdentityKeyPair();
    const initiator = new HandshakeInitiator(alice);
    const responder = new HandshakeResponder(bob);

    const init = toFields(await initiator.createInit());
    const { responseFields } = await responder.handleInit(init);
    const fields = toFields(responseFields);

    await initiator.handleResponse(fields);
    await expect(initiator.handleResponse(fields)).rejects.toThrow(HandshakeError);
  });

  it("rejects an init envelope with the wrong msgType", async () => {
    const bob = await generateIdentityKeyPair();
    const responder = new HandshakeResponder(bob);
    const badFields: EnvelopeFields = {
      version: 1,
      senderKeyId: new Uint8Array(8),
      sessionKeyId: new Uint8Array(8),
      msgType: MsgType.DATA,
      iv: new Uint8Array(12),
      payload: new Uint8Array(0),
    };
    await expect(responder.handleInit(badFields)).rejects.toThrow(HandshakeError);
  });
});

describe("createSessionKeyAck", () => {
  it("builds an ACK envelope with the correct senderKeyId and empty payload", async () => {
    const { publicKey } = await generateIdentityKeyPair();
    const jwk = await exportPublicKeyJwk(publicKey);
    const expectedSenderKeyId = await shortKeyId(jwk);
    const sessionKeyId = crypto.getRandomValues(new Uint8Array(8));

    const ack = await createSessionKeyAck(jwk, sessionKeyId);
    expect(ack.senderKeyId).toEqual(expectedSenderKeyId);
    expect(ack.sessionKeyId).toEqual(sessionKeyId);
    expect(ack.msgType).toBe(MsgType.SESSION_KEY_ACK);
    expect(ack.payload.length).toBe(0);
  });
});

describe("detectKeyChange", () => {
  it("returns false when there is no existing key on file", () => {
    expect(detectKeyChange(null, new Uint8Array(8))).toBe(false);
  });

  it("returns false when the incoming key id matches the one on file", () => {
    const id = crypto.getRandomValues(new Uint8Array(8));
    expect(detectKeyChange(id, id)).toBe(false);
  });

  it("returns true when the incoming key id differs from the one on file", () => {
    const existing = new Uint8Array(8).fill(1);
    const incoming = new Uint8Array(8).fill(2);
    expect(detectKeyChange(existing, incoming)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `pnpm --filter @waxseal/crypto-core test -- handshake.test.ts`
Expected: all tests PASS.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @waxseal/crypto-core typecheck`
Expected: exits 0, no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/crypto-core/test/handshake.test.ts
git commit -m "test(crypto-core): add handshake.ts coverage"
```

---

### Task 9: Full verification and README status fix

**Files:**
- Modify: `README.md:9-12`

**Problem:** `README.md`'s "Status" line currently reads as if a working,
site-agnostic adapter and end-to-end proof already exist. As of this plan,
only `crypto-core` exists (now with tests); `adapter-api`, `adapter-generic`,
`extension-core`, `build`, and `e2e` are all still unbuilt. Correct the claim
so it doesn't overstate progress.

- [ ] **Step 1: Run the full workspace verification suite**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: `lint` and `typecheck` exit 0. `test` runs the six new
`crypto-core` test files (Tasks 3-8) and passes; no other package currently
defines a `test` script, so `pnpm -r run test` (the root `test` script) only
executes `crypto-core`'s.

If anything fails, treat it as a real bug surfaced by the new tests (not a
plan error) and fix the underlying `packages/crypto-core/src/*.ts` code,
re-running this step until it's clean, before moving on.

- [ ] **Step 2: Correct the README status line**

Current `README.md`:

```markdown
Status: **proof of concept**. Crypto core + a generic (site-agnostic) adapter,
provable end-to-end against a local test page. Real site adapters (starting
with Bale, Eitaa, and Soroush Plus) are a planned follow-up — see
`docs/ADAPTER_GUIDE.md`.
```

New:

```markdown
Status: **early proof of concept, pre-alpha**. `packages/crypto-core`
(identity keys, handshake, envelope encoding, session encryption) is
implemented and tested. The site-agnostic adapter, the browser extension
shell (background/content-script/popup), the build tooling, and the
end-to-end proof against a local test page are not built yet — see
`docs/ADAPTER_GUIDE.md` for the adapter interface these will implement.
```

- [ ] **Step 3: Verify the full suite one more time after the doc edit**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: same clean result as Step 1 (README changes don't affect code
checks, but this confirms nothing was accidentally left broken).

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: correct README status to match actual implementation state"
```
