import type { SiteAdapter } from "@waxseal/adapter-api";
import { baleAdapter } from "@waxseal/adapter-bale";
import { findEnvelopeToken, MARKER } from "@waxseal/crypto-core";
import type {
  BackgroundRequest,
  BackgroundResponse,
  ContentScriptMessage,
} from "./protocol.js";

async function sendToBackground(req: BackgroundRequest): Promise<BackgroundResponse | null> {
  try {
    const res = (await chrome.runtime.sendMessage(req)) as BackgroundResponse | undefined;
    return res ?? null;
  } catch {
    return null;
  }
}

let currentAdapter: SiteAdapter = baleAdapter;

export function startContentScript(adapter: SiteAdapter): void {
  currentAdapter = adapter;
  setupSendIntercept(adapter);
  setupMutationObserver(adapter);
  registerInjectListener(adapter);
}

function setupSendIntercept(adapter: SiteAdapter): void {
  const composer = adapter.getComposerElement();
  if (!composer) return;

  composer.addEventListener(
    "keydown",
    (ev: Event) => {
      const keyEv = ev as KeyboardEvent;
      if (keyEv.key !== "Enter" || keyEv.shiftKey) return;

      const plaintext = adapter.extractMessageText(composer as Element);
      if (!plaintext.trim()) return;

      // Already encrypted — let the native send proceed unmodified
      if (plaintext.includes(MARKER)) return;

      // Prevent the default send so we can encrypt first
      ev.preventDefault();
      ev.stopImmediatePropagation();

      void (async () => {
        // Get current context from background
        const ctx = await sendToBackground({ type: "GET_CONTEXT" });
        if (!ctx || !ctx.ok || ctx.type !== "CONTEXT" || !ctx.peerKeyIdHex) return;
        if (ctx.state !== "ACTIVE") return;

        const encRes = await sendToBackground({
          type: "ENCRYPT",
          plaintext,
          peerKeyIdHex: ctx.peerKeyIdHex,
        });
        if (!encRes || !encRes.ok || encRes.type !== "ENCRYPTED") return;

        adapter.injectOutgoingText(composer as Element, encRes.envelopeB64);
        adapter.triggerSend(composer as Element);
      })();
    },
    true, // capture phase: intercept before the site's own handler
  );
}

function setupMutationObserver(adapter: SiteAdapter): void {
  const root = adapter.getMessageListRoot();
  if (!root) return;

  const observer = new MutationObserver((mutations) => {
    for (const mut of mutations) {
      for (const node of Array.from(mut.addedNodes)) {
        if (adapter.isMessageNode(node)) {
          void processIncomingNode(adapter, node as Element);
        }
      }
    }
  });

  observer.observe(root, { childList: true, subtree: false });

  // Process any waxseal messages already in the DOM
  for (const node of Array.from(root.children)) {
    const text = adapter.extractMessageText(node);
    if (text.includes(MARKER)) {
      void processIncomingNode(adapter, node);
    }
  }
}

async function processIncomingNode(adapter: SiteAdapter, node: Element): Promise<void> {
  const text = adapter.extractMessageText(node);
  const token = findEnvelopeToken(text);
  if (!token) return;

  const res = await sendToBackground({ type: "DECRYPT", envelopeB64: token });
  if (res && res.ok && res.type === "DECRYPTED") {
    adapter.replaceMessageText(node, res.plaintext);
  } else if (res && !res.ok && res.error === "KEY_CHANGE_DETECTED") {
    // KEY_CHANGE_DETECTED: leave message as encrypted — popup will show warning
  }
  // DECRYPT_FAILED / NO_SESSION / NO_PEER: leave message as-is
}

function registerInjectListener(adapter: SiteAdapter): void {
  chrome.runtime.onMessage.addListener((msg: unknown) => {
    const message = msg as ContentScriptMessage;
    if (message.type === "INJECT_ENVELOPE") {
      const composer = adapter.getComposerElement();
      if (!composer) return;
      adapter.injectOutgoingText(composer, message.envelopeB64);
      adapter.triggerSend(composer);
    }
  });
}

// Auto-start in production when loaded as a content script
if (typeof document !== "undefined" && baleAdapter.matches(globalThis.location?.href ?? "")) {
  startContentScript(currentAdapter);
}
