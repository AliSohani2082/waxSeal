import { test, expect } from "@playwright/test";
import {
  launchWithExtension,
  closeContext,
  serveFixture,
  bgSend,
  addIncoming,
  getLastMessage,
  waitForState,
  FIXTURE_URL,
} from "./helpers.js";

const MARKER = "⁉WAXSEAL1:";

test.describe("handshake flow", () => {
  test("two instances complete a handshake and both sessions become ACTIVE", async () => {
    const alice = await launchWithExtension();
    const bob = await launchWithExtension();

    try {
      const alicePage = await alice.ctx.newPage();
      const bobPage = await bob.ctx.newPage();

      // Serve fixture on both pages
      await serveFixture(alicePage);
      await serveFixture(bobPage);

      await alicePage.goto(FIXTURE_URL, { waitUntil: "domcontentloaded" });
      await bobPage.goto(FIXTURE_URL, { waitUntil: "domcontentloaded" });

      // Give content scripts time to initialize
      await alicePage.waitForTimeout(500);
      await bobPage.waitForTimeout(500);

      // ── Step 1: Alice initiates handshake ─────────────────────────────────
      // Background receives INITIATE_HANDSHAKE, generates HANDSHAKE_INIT envelope,
      // sends INJECT_ENVELOPE to the content script in Alice's tab.
      // Content script injects envelope text into composer and triggers send.
      // Fixture page adds it as a "mine" bubble.
      const aliceInitRes = await bgSend(alicePage, { type: "INITIATE_HANDSHAKE" });
      expect(aliceInitRes.ok).toBe(true);
      expect((aliceInitRes as { type: string }).type).toBe("HANDSHAKE_INJECTED");

      // Wait for content script to inject and send the envelope
      await alicePage.waitForFunction(
        (marker: string) =>
          Array.from(
            document.querySelectorAll('[data-testid="message-bubble"]')
          ).some((el) => (el.textContent ?? "").includes(marker)),
        MARKER,
        { timeout: 5000 }
      );

      const aliceInitEnvelope = await getLastMessage(alicePage);
      expect(aliceInitEnvelope).toContain(MARKER);

      // ── Step 2: Deliver Alice's INIT to Bob ───────────────────────────────
      // Bob's MutationObserver picks up the new bubble → DECRYPT → processes
      // HANDSHAKE_INIT → injects HANDSHAKE_RESPONSE into Bob's tab.
      await addIncoming(bobPage, aliceInitEnvelope);

      // Wait for Bob to process the INIT and inject a HANDSHAKE_RESPONSE
      await bobPage.waitForFunction(
        (marker: string) =>
          Array.from(
            document.querySelectorAll('[data-testid="message-bubble"]')
          ).some((el) => (el.textContent ?? "").includes(marker)),
        MARKER,
        { timeout: 8000 }
      );

      // ── Step 3: Verify Bob's session state ───────────────────────────────
      expect(await waitForState(bobPage, "ACTIVE")).toBe("ACTIVE");

      // ── Step 4: Deliver Bob's RESPONSE back to Alice ──────────────────────
      const bobResponseEnvelope = await getLastMessage(bobPage);
      expect(bobResponseEnvelope).toContain(MARKER);

      await addIncoming(alicePage, bobResponseEnvelope);

      // ── Step 5: Verify Alice's session state ─────────────────────────────
      // Alice processes Bob's response (RSA unwrap) and reaches ACTIVE.
      expect(await waitForState(alicePage, "ACTIVE")).toBe("ACTIVE");
    } finally {
      await closeContext(alice);
      await closeContext(bob);
    }
  });
});
