// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MARKER } from "@waxseal/crypto-core";

// Mock chrome.runtime before importing content-script
const mockSendMessage = vi.fn();
globalThis.chrome = {
  runtime: {
    sendMessage: mockSendMessage,
    onMessage: { addListener: vi.fn() },
  },
} as unknown as typeof chrome;

// Mock the bale adapter so we control DOM queries
vi.mock("@waxseal/adapter-bale", () => ({
  baleAdapter: {
    id: "bale",
    matches: (_url: string) => true,
    getComposerElement: () => document.querySelector("#composer"),
    getSendTrigger: () => ({ type: "enter" }),
    injectOutgoingText: (el: Element, text: string) => {
      el.textContent = text;
    },
    triggerSend: (el: Element) => {
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    },
    getMessageListRoot: () => document.querySelector("#messages"),
    isMessageNode: (node: Node) =>
      node instanceof Element && node.classList.contains("bubble"),
    extractMessageText: (node: Element) => node.textContent ?? "",
    replaceMessageText: (node: Element, text: string) => {
      node.textContent = `🔒 ${text}`;
    },
  },
}));

describe("content-script", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    document.body.innerHTML = `
      <div id="messages"></div>
      <div id="composer" contenteditable="true"></div>
    `;
    // Re-import to reset module state
    vi.resetModules();
    await import("../src/content-script");
  });

  it("intercepts Enter keydown on composer, encrypts, and injects ciphertext", async () => {
    mockSendMessage.mockResolvedValueOnce({
      ok: true,
      type: "CONTEXT",
      peerKeyIdHex: "aabb",
      state: "ACTIVE",
    });
    mockSendMessage.mockResolvedValueOnce({
      ok: true,
      type: "ENCRYPTED",
      envelopeB64: "⁉WAXSEAL1:encoded",
    });

    const composer = document.querySelector("#composer")!;
    composer.textContent = "hello world";

    const ev = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    composer.dispatchEvent(ev);

    await new Promise((r) => setTimeout(r, 10));

    expect(mockSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "ENCRYPT", plaintext: "hello world" }),
    );
    expect(composer.textContent).toBe("⁉WAXSEAL1:encoded");
  });

  it("MutationObserver routes waxseal messages to background for decryption", async () => {
    mockSendMessage.mockResolvedValueOnce({
      ok: true,
      type: "DECRYPTED",
      plaintext: "secret",
      peerKeyIdHex: "aabb",
    });

    const messages = document.querySelector("#messages")!;
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = `${MARKER}encodeddata`;
    messages.appendChild(bubble);

    await new Promise((r) => setTimeout(r, 10));

    expect(mockSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "DECRYPT", envelopeB64: `${MARKER}encodeddata` }),
    );
    expect(bubble.textContent).toBe("🔒 secret");
  });

  it("leaves non-waxseal messages untouched", async () => {
    const messages = document.querySelector("#messages")!;
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = "plain text message";
    messages.appendChild(bubble);

    await new Promise((r) => setTimeout(r, 10));

    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(bubble.textContent).toBe("plain text message");
  });

  it("leaves message as-is on KEY_CHANGE_DETECTED", async () => {
    mockSendMessage.mockResolvedValueOnce({ ok: false, error: "KEY_CHANGE_DETECTED" });
    const messages = document.querySelector("#messages")!;
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = `${MARKER}somebase64`;
    messages.appendChild(bubble);

    await new Promise((r) => setTimeout(r, 10));

    // text must remain unchanged
    expect(bubble.textContent).toBe(`${MARKER}somebase64`);
  });

  it("leaves message as-is on DECRYPT_FAILED", async () => {
    mockSendMessage.mockResolvedValueOnce({ ok: false, error: "DECRYPT_FAILED" });
    const messages = document.querySelector("#messages")!;
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = `${MARKER}somebase64`;
    messages.appendChild(bubble);

    await new Promise((r) => setTimeout(r, 10));

    expect(bubble.textContent).toBe(`${MARKER}somebase64`);
  });
});
