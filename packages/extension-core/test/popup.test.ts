// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock chrome.runtime and chrome.tabs before importing popup
const mockSendMessage = vi.fn();
const mockTabsQuery = vi.fn();
const mockTabsGet = vi.fn();

globalThis.chrome = {
  runtime: {
    sendMessage: mockSendMessage,
  },
  tabs: {
    query: mockTabsQuery,
    get: mockTabsGet,
  },
} as unknown as typeof chrome;

// We will test the exported functions directly
// The popup module exports: sendToBackground, getActiveTabId, refresh, init
// Auto-initialization is gated on DOMContentLoaded so we can import safely

describe("popup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();

    // Reset DOM to popup.html structure
    document.body.innerHTML = `
      <div id="not-bale" style="display:none">Not on a Bale web chat page.</div>
      <div id="main" style="display:none">
        <div id="key-change-warning" style="display:none">
          ⚠️ Identity key changed — re-verify safety number with your contact.
        </div>
        <div id="status" class="idle">Status: loading…</div>
        <div id="safety-number" style="display:none"></div>
        <button id="start-btn" disabled>Start secure chat</button>
      </div>
    `;

    // Clear sessionStorage between tests
    sessionStorage.clear();
  });

  describe("refresh()", () => {
    it("sets status class and text to idle when state is IDLE", async () => {
      mockSendMessage.mockResolvedValueOnce({
        ok: true,
        type: "CONTEXT",
        peerKeyIdHex: null,
        state: "IDLE",
      });

      const { refresh } = await import("../src/popup.js");
      await refresh(1);

      const statusEl = document.getElementById("status")!;
      expect(statusEl.className).toBe("idle");
      expect(statusEl.textContent).toBe("Status: IDLE");
    });

    it("sets status class to pending and disables start button when state is PENDING", async () => {
      mockSendMessage.mockResolvedValueOnce({
        ok: true,
        type: "CONTEXT",
        peerKeyIdHex: null,
        state: "PENDING",
      });

      const { refresh } = await import("../src/popup.js");
      await refresh(1);

      const statusEl = document.getElementById("status")!;
      const startBtn = document.getElementById("start-btn") as HTMLButtonElement;
      expect(statusEl.className).toBe("pending");
      expect(statusEl.textContent).toBe("Status: PENDING");
      expect(startBtn.disabled).toBe(true);
    });

    it("disables start button when state is ACTIVE", async () => {
      mockSendMessage.mockResolvedValueOnce({
        ok: true,
        type: "CONTEXT",
        peerKeyIdHex: "aabb",
        state: "ACTIVE",
      });
      mockSendMessage.mockResolvedValueOnce({
        ok: true,
        type: "SAFETY_NUMBER",
        number: "1234 5678 9012",
      });

      const { refresh } = await import("../src/popup.js");
      await refresh(1);

      const startBtn = document.getElementById("start-btn") as HTMLButtonElement;
      expect(startBtn.disabled).toBe(true);
    });

    it("shows safety number when state is ACTIVE", async () => {
      mockSendMessage.mockResolvedValueOnce({
        ok: true,
        type: "CONTEXT",
        peerKeyIdHex: "aabb",
        state: "ACTIVE",
      });
      mockSendMessage.mockResolvedValueOnce({
        ok: true,
        type: "SAFETY_NUMBER",
        number: "1234 5678 9012",
      });

      const { refresh } = await import("../src/popup.js");
      await refresh(1);

      const safetyEl = document.getElementById("safety-number")!;
      expect(safetyEl.style.display).toBe("block");
      expect(safetyEl.textContent).toContain("1234 5678 9012");
    });

    it("hides safety number when state is IDLE", async () => {
      mockSendMessage.mockResolvedValueOnce({
        ok: true,
        type: "CONTEXT",
        peerKeyIdHex: null,
        state: "IDLE",
      });

      const { refresh } = await import("../src/popup.js");
      await refresh(1);

      const safetyEl = document.getElementById("safety-number")!;
      expect(safetyEl.style.display).toBe("none");
    });

    it("shows key-change warning when GET_SAFETY_NUMBER returns KEY_CHANGE_DETECTED", async () => {
      mockSendMessage.mockResolvedValueOnce({
        ok: true,
        type: "CONTEXT",
        peerKeyIdHex: "aabb",
        state: "ACTIVE",
      });
      mockSendMessage.mockResolvedValueOnce({
        ok: false,
        error: "KEY_CHANGE_DETECTED",
      });

      const { refresh } = await import("../src/popup.js");
      await refresh(1);

      const warningEl = document.getElementById("key-change-warning")!;
      const safetyEl = document.getElementById("safety-number")!;
      expect(warningEl.style.display).toBe("block");
      expect(safetyEl.style.display).toBe("none");
    });

    it("hides key-change warning when GET_SAFETY_NUMBER returns safety number successfully", async () => {
      mockSendMessage.mockResolvedValueOnce({
        ok: true,
        type: "CONTEXT",
        peerKeyIdHex: "aabb",
        state: "ACTIVE",
      });
      mockSendMessage.mockResolvedValueOnce({
        ok: true,
        type: "SAFETY_NUMBER",
        number: "1234 5678 9012",
      });

      const { refresh } = await import("../src/popup.js");
      await refresh(1);

      const warningEl = document.getElementById("key-change-warning")!;
      expect(warningEl.style.display).toBe("none");
    });

    it("returns early when GET_CONTEXT response is not ok", async () => {
      mockSendMessage.mockResolvedValueOnce({
        ok: false,
        error: "NO_SESSION",
      });

      const { refresh } = await import("../src/popup.js");
      await refresh(1);

      // Status should remain unchanged
      const statusEl = document.getElementById("status")!;
      expect(statusEl.textContent).toBe("Status: loading…");
    });

    it("enables start button when state is IDLE", async () => {
      mockSendMessage.mockResolvedValueOnce({
        ok: true,
        type: "CONTEXT",
        peerKeyIdHex: null,
        state: "IDLE",
      });

      const { refresh } = await import("../src/popup.js");
      await refresh(1);

      const startBtn = document.getElementById("start-btn") as HTMLButtonElement;
      expect(startBtn.disabled).toBe(false);
    });
  });

  describe("init()", () => {
    it("shows not-bale message when no active tab is found", async () => {
      mockTabsQuery.mockImplementation(
        (_query: unknown, cb: (tabs: chrome.tabs.Tab[]) => void) => {
          cb([]);
        },
      );

      const { init } = await import("../src/popup.js");
      await init();

      const notBaleEl = document.getElementById("not-bale")!;
      expect(notBaleEl.style.display).toBe("block");
    });

    it("shows not-bale message when tab URL is not web.bale.ai", async () => {
      mockTabsQuery.mockImplementation(
        (_query: unknown, cb: (tabs: chrome.tabs.Tab[]) => void) => {
          cb([{ id: 1 } as chrome.tabs.Tab]);
        },
      );
      mockTabsGet.mockImplementation(
        (_id: number, cb: (tab: chrome.tabs.Tab) => void) => {
          cb({ id: 1, url: "https://example.com" } as chrome.tabs.Tab);
        },
      );

      const { init } = await import("../src/popup.js");
      await init();

      const notBaleEl = document.getElementById("not-bale")!;
      expect(notBaleEl.style.display).toBe("block");
    });

    it("shows main UI when tab URL contains web.bale.ai", async () => {
      mockTabsQuery.mockImplementation(
        (_query: unknown, cb: (tabs: chrome.tabs.Tab[]) => void) => {
          cb([{ id: 5 } as chrome.tabs.Tab]);
        },
      );
      mockTabsGet.mockImplementation(
        (_id: number, cb: (tab: chrome.tabs.Tab) => void) => {
          cb({ id: 5, url: "https://web.bale.ai/chat/123" } as chrome.tabs.Tab);
        },
      );
      mockSendMessage.mockResolvedValueOnce({
        ok: true,
        type: "CONTEXT",
        peerKeyIdHex: null,
        state: "IDLE",
      });

      const { init } = await import("../src/popup.js");
      await init();

      // Need to wait a tick for the async refresh inside chrome.tabs.get callback
      await new Promise((r) => setTimeout(r, 10));

      const mainEl = document.getElementById("main")!;
      expect(mainEl.style.display).toBe("block");
    });
  });
});
