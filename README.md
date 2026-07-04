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
