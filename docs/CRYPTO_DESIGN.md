# Crypto Design

This document is the source of truth for waxseal's cryptography. Code in
`packages/crypto-core` must match this document; if they diverge, update both
in the same PR.

## Identity keys

- One RSA-OAEP (SHA-256, 3072-bit modulus) keypair per device, generated with
  `crypto.subtle.generateKey`.
- Stored as a non-extractable `CryptoKey` in IndexedDB by default: usable only
  via SubtleCrypto, not exfiltratable by reading storage directly.
- Public key exported/transmitted as JWK.
- One identity per device (not per account, not per site). Multi-device sync
  is out of scope for now — see "Known limitations" below.

## Session keys

- Per conversation, scoped to `(my device identity, peer public-key
  fingerprint)` — not per-site, so a session survives a contact being talked
  to on more than one site.
- A random AES-256-GCM key, generated with `crypto.subtle.generateKey`.
- Transported by RSA-OAEP-encrypting the raw 32 key bytes under the peer's
  public key (`crypto.subtle.encrypt({ name: "RSA-OAEP" }, peerPublicKey,
  rawKeyBytes)`). RSA-OAEP at 3072-bit/SHA-256 comfortably wraps 32 bytes.
- Each session key has a short random `sessionKeyId` (8 bytes) so envelopes
  can reference which key they were encrypted under.

## Wire format / envelope

Ciphertext is embedded in outgoing chat text as:

```
<marker><base64url(envelope), no padding, no internal whitespace>
```

The marker is a fixed, distinctive, whitespace-free token (`⁉WAXSEAL1:`)
chosen so host chat UIs are unlikely to mangle, autolink, or spell-check it
away, and so both extensions can detect it deterministically.

Binary envelope layout (before base64url encoding):

| field         | size     | notes                                              |
|---------------|----------|-----------------------------------------------------|
| version       | 1 byte   | wire format version                                 |
| senderKeyId   | 8 bytes  | truncated fingerprint of sender's identity pubkey    |
| sessionKeyId  | 8 bytes  | which session key; all-zero for handshake messages   |
| msgType       | 1 byte   | see enum below                                       |
| iv            | 12 bytes | fresh random AES-GCM IV, **never reused per key**    |
| ciphertext    | variable | AES-GCM output (includes 16-byte auth tag)           |

`msgType` enum: `0 = DATA`, `1 = HANDSHAKE_INIT`, `2 = HANDSHAKE_RESPONSE`,
`3 = SESSION_KEY_ROTATE`, `4 = SESSION_KEY_ACK`. For handshake message types,
the "ciphertext" field instead carries the sender's exported public key JWK
plus (for `HANDSHAKE_RESPONSE`) the RSA-wrapped session key.

A malformed or truncated envelope (fails to base64url-decode to the expected
minimum length for its `msgType`, or fails the AES-GCM authentication tag
check) must **fail closed**: raise a typed decode error, and the content
script must show an inline "could not decrypt" indicator rather than
rendering corrupted or empty text as if it were a real message.

## Handshake (in-band, trust-on-first-use)

1. **A → B, `HANDSHAKE_INIT`**: A's public key JWK + a fresh random nonce.
   Rendered as a visible system-style line in the chat UI ("requesting secure
   channel") so the human on the other end isn't confused by opaque text.
2. **B → A, `HANDSHAKE_RESPONSE`**: B's public key JWK + a freshly generated
   AES-256-GCM session key, RSA-OAEP-wrapped under A's public key, echoing A's
   nonce (binds the response to this specific request and blocks replay of a
   stale response).
3. A RSA-decrypts the session key. Both sides now share one AES-GCM key.
   Message direction is disambiguated by `senderKeyId`, not by using separate
   keys per direction.
4. A sends `SESSION_KEY_ACK` once it has successfully decrypted, so B knows
   the channel is live rather than sending into the void.
5. **Key-change handling**: if a `HANDSHAKE_INIT` arrives for a peer that
   already has an active session, this is treated as a key-change event, not
   an automatic re-key. The UI must surface a clear warning and require
   explicit user action to accept the new key — this is the exact window a
   MITM/impersonation attempt would try to exploit.

## MITM mitigation: fingerprints / safety numbers

- Fingerprint = human-readable rendering of `SHA-256(canonical public key
  JWK bytes)`.
- The popup shows a combined "safety number" (both parties' fingerprints,
  sorted deterministically and concatenated) for out-of-band comparison —
  same approach as Signal's safety numbers.
- This is the **only** real defense against an active MITM on the handshake,
  since the handshake itself travels over a channel the platform operator
  could tamper with. Document this plainly to users: waxseal is TOFU +
  optional verification, not automatically MITM-proof.

## Forward secrecy (current, and future upgrade path)

- Current: static session key between rotations (rotate every N messages or
  T days — thresholds are configurable constants, not enforced as part of the
  POC). This is materially weaker than Signal's per-message Double Ratchet;
  refer to it as "session-level forward secrecy" in any user-facing docs, not
  as Signal-equivalent.
- Future (not built yet): migrate session establishment to ECDH (P-256 via
  SubtleCrypto, since X25519 support is inconsistent across browsers) plus a
  simple HKDF-based hash ratchet rotating the AES key after every message.
  The envelope's `version` and `msgType` fields exist specifically so this
  can be added as new `msgType` values without breaking the wire format.

## Known limitations

- No multi-device support: one identity keypair per device, so a contact's
  fingerprint changes if they reinstall or switch devices (surfaced as a
  key-change warning, as designed).
- No metadata protection — only message content is encrypted.
- No external security audit has been performed yet (see `SECURITY.md`).
