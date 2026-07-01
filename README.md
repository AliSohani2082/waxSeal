# waxseal

A Chrome/Firefox extension that layers end-to-end encryption on top of web
chat apps that don't support it natively. Two consenting users install the
extension; outgoing text is intercepted and encrypted before it reaches the
site's own send handler, flows through the site as an opaque blob, and is
decrypted and swapped back into the DOM on the receiving end.

Status: **proof of concept**. Crypto core + a generic (site-agnostic) adapter,
provable end-to-end against a local test page. Real site adapters (starting
with Bale, Eitaa, and Soroush Plus) are a planned follow-up — see
`docs/ADAPTER_GUIDE.md`.

- `docs/CRYPTO_DESIGN.md` — full cryptographic design (read this first).
- `docs/WIRE_FORMAT.md` — terse wire-format reference.
- `docs/ADAPTER_GUIDE.md` — how to add support for a new site.
- `SECURITY.md` — threat model and vulnerability reporting.

## Development

```sh
pnpm install
pnpm test          # crypto-core + extension-core unit tests
pnpm build:chrome   # -> dist/chrome, load unpacked via chrome://extensions
pnpm build:firefox  # -> dist/firefox, load via about:debugging
pnpm e2e            # Playwright, drives the local fixture page
```

## License

MIT — see `LICENSE`.
