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
const MALFORMED = "⁉WAXSEAL1:notvalidbase64!!!";

test.describe("message flow", () => {
  test("malformed envelope is left unchanged in the DOM (graceful failure)", async () => {
    const ec = await launchWithExtension();

    try {
      const page = await ec.ctx.newPage();
      await serveFixture(page);
      await page.goto(FIXTURE_URL, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(300);

      // Inject a malformed envelope as an incoming message.
      // The content script sees the MARKER, sends DECRYPT to background,
      // background throws EnvelopeDecodeError → returns { ok: false, error: "DECRYPT_FAILED" }.
      // Content script does NOT call replaceMessageText; bubble stays unchanged.
      await addIncoming(page, MALFORMED);
      await page.waitForTimeout(500);

      const bubbleText = await getLastMessage(page);
      expect(bubbleText).toBe(MALFORMED);
    } finally {
      await closeContext(ec);
    }
  });

  test("safety number is identical on both sides after completed handshake", async () => {
    const alice = await launchWithExtension();
    const bob = await launchWithExtension();

    try {
      const alicePage = await alice.ctx.newPage();
      const bobPage = await bob.ctx.newPage();

      await serveFixture(alicePage);
      await serveFixture(bobPage);
      await alicePage.goto(FIXTURE_URL, { waitUntil: "domcontentloaded" });
      await bobPage.goto(FIXTURE_URL, { waitUntil: "domcontentloaded" });
      await alicePage.waitForTimeout(500);
      await bobPage.waitForTimeout(500);

      // ── Perform full handshake ────────────────────────────────────────────

      // 1. Alice initiates
      const initRes = await bgSend(alicePage, { type: "INITIATE_HANDSHAKE" });
      expect(initRes.ok).toBe(true);

      await alicePage.waitForFunction(
        (marker: string) =>
          Array.from(
            document.querySelectorAll('[data-testid="message-bubble"]')
          ).some((el) => (el.textContent ?? "").includes(marker)),
        MARKER,
        { timeout: 5000 }
      );

      const aliceInit = await getLastMessage(alicePage);
      expect(aliceInit).toContain(MARKER);

      // 2. Deliver to Bob and wait until Bob has processed it (ACTIVE means
      //    Bob has injected the HANDSHAKE_RESPONSE bubble).
      await addIncoming(bobPage, aliceInit);
      expect(await waitForState(bobPage, "ACTIVE")).toBe("ACTIVE");

      // 3. Deliver Bob's response to Alice
      const bobResponse = await getLastMessage(bobPage);
      expect(bobResponse).toContain(MARKER);

      await addIncoming(alicePage, bobResponse);

      // ── Verify both ACTIVE ───────────────────────────────────────────────
      expect(await waitForState(alicePage, "ACTIVE")).toBe("ACTIVE");
      expect(await waitForState(bobPage, "ACTIVE")).toBe("ACTIVE");

      // ── Safety numbers ───────────────────────────────────────────────────
      const aliceSNRes = await bgSend(alicePage, { type: "GET_SAFETY_NUMBER" });
      expect(aliceSNRes.ok).toBe(true);
      const aliceSN = (aliceSNRes as { number: string }).number;
      expect(aliceSN).toBeTruthy();
      expect(aliceSN.length).toBeGreaterThan(0);

      const bobSNRes = await bgSend(bobPage, { type: "GET_SAFETY_NUMBER" });
      expect(bobSNRes.ok).toBe(true);
      const bobSN = (bobSNRes as { number: string }).number;
      expect(bobSN).toBeTruthy();

      // Both sides must compute the same safety number
      expect(aliceSN).toBe(bobSN);
    } finally {
      await closeContext(alice);
      await closeContext(bob);
    }
  });
});
