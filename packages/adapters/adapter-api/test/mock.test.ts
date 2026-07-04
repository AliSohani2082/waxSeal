import { describe, it, expect, beforeEach } from "vitest";
import { MockSiteAdapter } from "../src/mock.js";

describe("MockSiteAdapter", () => {
  let adapter: MockSiteAdapter;

  beforeEach(() => {
    adapter = new MockSiteAdapter();
  });

  it("matches any URL", () => {
    expect(adapter.matches("https://example.com")).toBe(true);
  });

  it("returns the mock composer element", () => {
    expect(adapter.getComposerElement()).not.toBeNull();
  });

  it("injectOutgoingText sets lastInjectedText and fires input event", () => {
    const el = adapter.getComposerElement()!;
    let inputFired = false;
    el.addEventListener("input", () => { inputFired = true; });
    adapter.injectOutgoingText(el, "hello");
    expect(adapter.lastInjectedText).toBe("hello");
    expect(inputFired).toBe(true);
  });

  it("triggerSend records send was called", () => {
    const el = adapter.getComposerElement()!;
    adapter.triggerSend(el);
    expect(adapter.sendTriggeredCount).toBe(1);
  });

  it("isMessageNode identifies mock message nodes", () => {
    const node = adapter.createMessageNode("hello");
    expect(adapter.isMessageNode(node)).toBe(true);
    expect(adapter.isMessageNode(document.createElement("div"))).toBe(false);
  });

  it("extractMessageText reads textContent", () => {
    const node = adapter.createMessageNode("hello") as Element;
    expect(adapter.extractMessageText(node)).toBe("hello");
  });

  it("replaceMessageText prepends lock emoji", () => {
    const node = adapter.createMessageNode("⁉WAXSEAL1:abc") as Element;
    adapter.replaceMessageText(node, "decrypted");
    expect(node.textContent).toBe("🔒 decrypted");
  });
});
