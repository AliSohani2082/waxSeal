import {
  chromium,
  type BrowserContext,
  type Page,
  type Worker,
} from "@playwright/test";
import { resolve } from "path";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

const EXTENSION_PATH = resolve(__dirname, "../../packages/build/dist/chrome");
const FIXTURE_FILE = resolve(
  __dirname,
  "../../packages/build/test/fixture-page/index.html"
);
const FIXTURE_URL = "https://web.bale.ai/fixture";

// ── Typed background response shapes ─────────────────────────────────────────

export type StatusState = "IDLE" | "PENDING" | "ACTIVE";

export interface OkStatus {
  ok: true;
  type: "STATUS";
  state: StatusState;
}
export interface OkContext {
  ok: true;
  type: "CONTEXT";
  peerKeyIdHex: string | null;
  state: StatusState;
}
export interface OkSafetyNumber {
  ok: true;
  type: "SAFETY_NUMBER";
  number: string;
}
export interface OkHandshakeInjected {
  ok: true;
  type: "HANDSHAKE_INJECTED";
}
export interface OkDecrypted {
  ok: true;
  type: "DECRYPTED";
  plaintext: string;
  peerKeyIdHex: string;
}
export interface ErrResponse {
  ok: false;
  error: string;
}
export type BackgroundResponse =
  | OkStatus
  | OkContext
  | OkSafetyNumber
  | OkHandshakeInjected
  | OkDecrypted
  | ErrResponse;

// ── Extension context helpers ─────────────────────────────────────────────────

export interface ExtensionContext {
  ctx: BrowserContext;
  userDataDir: string;
}

/**
 * Launches a Chromium persistent context with the waxseal extension loaded.
 * Each call creates a unique userDataDir in the OS temp directory so that
 * Alice and Bob have isolated IndexedDB / extension storage.
 */
export async function launchWithExtension(): Promise<ExtensionContext> {
  const userDataDir = mkdtempSync(join(tmpdir(), "waxseal-e2e-"));
  const ctx = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
    ],
    viewport: { width: 1280, height: 720 },
  });
  return { ctx, userDataDir };
}

/**
 * Closes a BrowserContext and removes its temporary userDataDir.
 */
export async function closeContext(ec: ExtensionContext): Promise<void> {
  await ec.ctx.close();
  rmSync(ec.userDataDir, { recursive: true, force: true });
}

/**
 * Registers a page.route() handler that intercepts all https://web.bale.ai/**
 * requests and serves the local fixture HTML file instead.
 * Must be called before page.goto(FIXTURE_URL).
 */
export async function serveFixture(page: Page): Promise<void> {
  const html = readFileSync(FIXTURE_FILE, "utf-8");
  await page.route("https://web.bale.ai/**", (route) => {
    void route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: html,
    });
  });
}

/** The URL to navigate to so that baleAdapter.matches() returns true */
export { FIXTURE_URL };

// ── Background driving ────────────────────────────────────────────────────────

/**
 * Returns the extension's background service worker for a context, waiting for
 * it to register if it has not appeared yet.
 */
async function getServiceWorker(ctx: BrowserContext): Promise<Worker> {
  const existing = ctx.serviceWorkers();
  if (existing[0]) return existing[0];
  return ctx.waitForEvent("serviceworker");
}

/**
 * Drives the background service worker directly and returns the typed response.
 *
 * A page's main world cannot message a content-script extension via
 * `chrome.runtime.sendMessage` (Chrome demands an extension id and routes such
 * calls to `onMessageExternal`). Instead we evaluate inside the service-worker
 * context — where the privileged `chrome.*` APIs live — resolve the fixture tab
 * id via `chrome.tabs.query`, and invoke the `__waxsealHandleMessage` test hook
 * with that tab id, exactly as the real `onMessage` listener would.
 */
export async function bgSend(
  page: Page,
  req: Record<string, unknown>
): Promise<BackgroundResponse> {
  const sw = await getServiceWorker(page.context());
  return sw.evaluate(async (message): Promise<BackgroundResponse> => {
    const g = globalThis as unknown as {
      __waxsealHandleMessage: (
        req: Record<string, unknown>,
        tabId: number
      ) => Promise<BackgroundResponse>;
    };
    const tabs = await chrome.tabs.query({ url: "https://web.bale.ai/*" });
    const tabId = tabs[0]?.id ?? -1;
    return g.__waxsealHandleMessage(message, tabId);
  }, req);
}

/**
 * Polls the background via GET_STATUS until the session reaches `state`
 * (or the timeout elapses). Returns the last observed state. This avoids
 * flakiness from fixed waits — RSA unwrap during the handshake can take a
 * few hundred milliseconds.
 */
export async function waitForState(
  page: Page,
  state: StatusState,
  timeoutMs = 8000
): Promise<StatusState> {
  const deadline = Date.now() + timeoutMs;
  let last: StatusState = "IDLE";
  while (Date.now() < deadline) {
    const res = await bgSend(page, { type: "GET_STATUS" });
    if (res.ok && res.type === "STATUS") {
      last = res.state;
      if (last === state) return last;
    }
    await page.waitForTimeout(100);
  }
  return last;
}

/**
 * Adds a message to the fixture page's incoming message list.
 * Simulates another user sending a waxseal envelope to this page.
 */
export async function addIncoming(page: Page, text: string): Promise<void> {
  await page.evaluate((t: string) => {
    (
      window as unknown as { addIncomingMessage: (t: string) => void }
    ).addIncomingMessage(t);
  }, text);
}

/**
 * Returns all message bubble texts from the fixture page.
 */
export async function getMessages(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid="message-bubble"]')).map(
      (el) => el.textContent ?? ""
    )
  );
}

/**
 * Returns the last message bubble text from the fixture page.
 */
export async function getLastMessage(page: Page): Promise<string> {
  const msgs = await getMessages(page);
  return msgs[msgs.length - 1] ?? "";
}
