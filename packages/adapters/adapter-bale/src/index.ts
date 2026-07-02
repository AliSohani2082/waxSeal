import type { SiteAdapter } from "@waxseal/adapter-api";

export const baleAdapter: SiteAdapter = {
  id: "bale",

  matches: (url) => url.includes("web.bale.ai"),

  getComposerElement: () =>
    document.querySelector('[aria-label="پیام"]') ?? null,

  getSendTrigger: () => ({ type: "enter" }),

  injectOutgoingText: (el, ciphertext) => {
    el.textContent = ciphertext;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  },

  triggerSend: (el) => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  },

  getMessageListRoot: () =>
    document.querySelector('[data-testid="message-list"]') ?? null,

  isMessageNode: (node) =>
    node instanceof Element && node.matches('[data-testid="message-bubble"]'),

  extractMessageText: (node) => node.textContent ?? "",

  replaceMessageText: (node, plaintext) => {
    node.textContent = `🔒 ${plaintext}`;
  },
};
