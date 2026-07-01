# Wire Format Quick Reference

See `docs/CRYPTO_DESIGN.md` for full rationale. This file is the terse,
implementation-facing reference.

```
token := MARKER || base64url_nopad(envelope)
MARKER := "⁉WAXSEAL1:"

envelope :=
    version:      u8
    senderKeyId:  8 bytes
    sessionKeyId: 8 bytes           (all-zero if msgType is a handshake type)
    msgType:      u8                (0=DATA 1=HANDSHAKE_INIT 2=HANDSHAKE_RESPONSE
                                      3=SESSION_KEY_ROTATE 4=SESSION_KEY_ACK)
    iv:           12 bytes          (fresh CSPRNG per encryption, never reused per key)
    payload:      remaining bytes
```

`payload` contents depend on `msgType`:

- `DATA`: `AES-GCM.encrypt(sessionKey, iv, utf8(plaintext))` — ciphertext
  includes the 16-byte GCM tag appended by SubtleCrypto.
- `HANDSHAKE_INIT`: `nonce (16 bytes) || senderPublicKeyJwkBytes`
- `HANDSHAKE_RESPONSE`: `echoedNonce (16 bytes) || RSA-OAEP(peerPubKey,
  rawSessionKeyBytes) || responderPublicKeyJwkBytes`
- `SESSION_KEY_ROTATE`: `RSA-OAEP(peerPubKey, newRawSessionKeyBytes)`
- `SESSION_KEY_ACK`: empty payload

Decoding rules:

1. Reject anything shorter than the fixed-field minimum (30 bytes before
   payload) — fail closed with a typed error, never throw an unhandled
   exception and never emit partial plaintext.
2. Reject unknown `version` bytes explicitly rather than attempting to parse
   under an assumed layout.
3. AES-GCM tag verification failure must be treated identically to "could not
   decrypt" — do not distinguish "wrong key" from "corrupted" in the UI, to
   avoid leaking oracle information.
