# Security Policy

## Threat model (summary)

waxseal encrypts chat message content between two consenting endpoints running
the extension, so that the messaging platform operator (and anyone with access
to its servers/logs) only ever sees ciphertext. See `docs/CRYPTO_DESIGN.md` for
the full design.

**In scope / defended against:**
- The messaging platform operator reading message content.
- Passive network observers between either endpoint and the platform.
- A third party who has not been fingerprint-verified attempting to impersonate
  a contact (mitigated by TOFU + safety-number verification, not eliminated).

**Explicitly out of scope / not defended against:**
- A compromised endpoint device (malware with access to the browser profile can
  read plaintext directly, same as any client-side encryption tool).
- Metadata (who talks to whom, when, how often) — only message *content* is
  encrypted.
- A user who never performs out-of-band fingerprint verification is trusting
  TOFU (trust-on-first-use), which does not stop an active MITM on the very
  first handshake.
- Forward secrecy is session-level (static key between rotations), not
  per-message like Signal's Double Ratchet. See `docs/CRYPTO_DESIGN.md` for the
  documented upgrade path.

## Reporting a vulnerability

This project has not yet had an external security audit. If you find a
vulnerability, please open a private security advisory on GitHub (or, if
unavailable, email the maintainer listed in the repository) rather than a
public issue, so a fix can be prepared before public disclosure.
