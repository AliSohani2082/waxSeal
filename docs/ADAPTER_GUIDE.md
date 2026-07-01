# Writing a Site Adapter

A `SiteAdapter` tells waxseal's shared content-script logic how to find a
chat site's composer and message list. The interface lives in
`packages/adapters/adapter-api/src/index.ts`:

```ts
interface SiteAdapter {
  id: string;
  matches(url: string): boolean;
  getComposerElement(): Element | null;
  getSendTrigger(): { type: "enter" | "click"; element?: Element };
  injectOutgoingText(el: Element, ciphertext: string): void;
  triggerSend(el: Element): void;
  getMessageListRoot(): Element | null;
  isMessageNode(node: Node): boolean;
  extractMessageText(node: Element): string;
  replaceMessageText(node: Element, plaintext: string): void;
  onDispose?(): void;
}
```

## Steps

1. Copy the template with `pnpm tsx scripts/new-adapter.ts <site-id>` (or copy
   `packages/adapters/adapter-generic` by hand as a starting point).
2. Open the target site and use devtools to find:
   - The composer element's stable selector (prefer `aria-label`/role over
     generated class names, which tend to churn on SPA rebuilds).
   - Whether the site's send action is Enter-keydown, a button click, or
     both — implement `getSendTrigger`/`triggerSend` accordingly. Setting
     `.value`/`.textContent` alone frequently does **not** trigger a
     framework-controlled site's internal state; you may need a synthetic
     `keydown`/`input` event or `.click()` on the actual send button.
   - The message list container and what distinguishes a "message" node from
     other DOM churn (`isMessageNode`).
   - Whether the message list is virtualized (nodes removed/re-added while
     scrolling). If so, `isMessageNode`/decryption must be idempotent — a node
     scrolling back into view and getting re-decrypted is expected, not a bug.
3. Write unit tests against **static HTML fixtures** (a saved snapshot of the
   real site's relevant DOM), not the live site, using the `MockSiteAdapter`
   harness in `adapter-api`. Check the fixture into
   `packages/adapters/adapter-<id>/test/fixtures/`.
4. Register the adapter and add its required host permission to both
   `packages/build/manifest.chrome.json` and `manifest.firefox.json` —
   Manifest V3 requires `host_permissions`/`content_scripts.matches` to be
   declared per-domain up front, so a new adapter needs a manifest change and
   a new extension release, not just a runtime toggle.
5. Because sites change their DOM without notice, expect the fixture and
   selectors to need periodic refresh. Document any known-fragile selectors
   in the adapter's own README.
