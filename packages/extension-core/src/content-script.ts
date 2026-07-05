import type { SiteAdapter } from "@waxseal/adapter-api";
import { baleAdapter } from "@waxseal/adapter-bale";
import { findEnvelopeToken, MARKER } from "@waxseal/crypto-core";
import type {
	BackgroundRequest,
	BackgroundResponse,
	ContentScriptMessage,
} from "./protocol.js";

async function sendToBackground(
	req: BackgroundRequest,
): Promise<BackgroundResponse | null> {
	try {
		const res = (await chrome.runtime.sendMessage(req)) as
			| BackgroundResponse
			| undefined;
		return res ?? null;
	} catch {
		return null;
	}
}

let currentAdapter: SiteAdapter = baleAdapter;

// Envelopes this content script injected itself. The message list renders our
// own outgoing envelopes as bubbles too, and the MutationObserver would
// otherwise feed them straight back into the background — turning our own
// HANDSHAKE_INIT into a self-handshake. We skip any node whose token we
// injected. Bounded so it cannot grow without limit on a long-lived tab.
const selfInjected = new Set<string>();

function rememberSelfInjected(envelopeB64: string): void {
	selfInjected.add(envelopeB64);
	if (selfInjected.size > 256) {
		const oldest = selfInjected.values().next().value;
		if (oldest !== undefined) selfInjected.delete(oldest);
	}
}

function injectAndSend(
	adapter: SiteAdapter,
	composer: Element,
	envelopeB64: string,
): void {
	rememberSelfInjected(envelopeB64);
	adapter.injectOutgoingText(composer, envelopeB64);
	adapter.triggerSend(composer);
}

let started = false;

export function startContentScript(adapter: SiteAdapter): void {
	if (started) return;
	started = true;
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
				if (!ctx?.ok || ctx.type !== "CONTEXT" || !ctx.peerKeyIdHex) return;
				if (ctx.state !== "ACTIVE") return;

				const encRes = await sendToBackground({
					type: "ENCRYPT",
					plaintext,
					peerKeyIdHex: ctx.peerKeyIdHex,
				});
				if (!encRes?.ok || encRes.type !== "ENCRYPTED") return;

				injectAndSend(adapter, composer as Element, encRes.envelopeB64);
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

async function processIncomingNode(
	adapter: SiteAdapter,
	node: Element,
): Promise<void> {
	const text = adapter.extractMessageText(node);
	const token = findEnvelopeToken(text);
	if (!token) return;

	// Skip envelopes we injected ourselves — otherwise we would process our own
	// outgoing handshake/messages as if they had arrived from the peer.
	if (selfInjected.has(token)) return;

	const res = await sendToBackground({ type: "DECRYPT", envelopeB64: token });
	if (res?.ok && res.type === "DECRYPTED") {
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
			injectAndSend(adapter, composer, message.envelopeB64);
		}
	});
}

// Auto-start in production when loaded as a content script
if (
	typeof document !== "undefined" &&
	baleAdapter.matches(globalThis.location?.href ?? "")
) {
	startContentScript(currentAdapter);
}
