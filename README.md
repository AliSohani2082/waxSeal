# waxseal

A Chrome/Firefox extension that layers end-to-end encryption on top of web
chat apps that don't support it natively. Two consenting users install the
extension; outgoing text is intercepted and encrypted before it reaches the
site's own send handler, flows through the site as an opaque blob, and is
decrypted and swapped back into the DOM on the receiving end.

Status: **early proof of concept, pre-alpha**. `packages/crypto-core`
(identity keys, handshake, envelope encoding, session encryption) is
implemented and tested. The site-agnostic adapter, the browser extension
shell (background/content-script/popup), the build tooling, and the
end-to-end proof against a local test page are not built yet — see
`docs/ADAPTER_GUIDE.md` for the adapter interface these will implement.

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
