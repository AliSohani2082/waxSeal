import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { baleAdapter } from "../src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureHtml = readFileSync(
	join(__dirname, "fixtures/bale-chat.html"),
	"utf-8",
);

describe("baleAdapter", () => {
	beforeEach(() => {
		document.body.innerHTML = fixtureHtml;
	});

	it("matches web.bale.ai URLs only", () => {
		expect(baleAdapter.matches("https://web.bale.ai/chat/123")).toBe(true);
		expect(baleAdapter.matches("https://web.telegram.org")).toBe(false);
	});

	it("getComposerElement returns the Persian-label input", () => {
		expect(baleAdapter.getComposerElement()).not.toBeNull();
	});

	it("injectOutgoingText sets textContent and fires input event", () => {
		const el = baleAdapter.getComposerElement()!;
		let fired = false;
		el.addEventListener("input", () => {
			fired = true;
		});
		baleAdapter.injectOutgoingText(el, "⁉WAXSEAL1:abc123");
		expect(el.textContent).toBe("⁉WAXSEAL1:abc123");
		expect(fired).toBe(true);
	});

	it("triggerSend dispatches Enter keydown on composer", () => {
		const el = baleAdapter.getComposerElement()!;
		let key: string | null = null;
		el.addEventListener("keydown", (e) => {
			key = (e as KeyboardEvent).key;
		});
		baleAdapter.triggerSend(el);
		expect(key).toBe("Enter");
	});

	it("getMessageListRoot returns the message list", () => {
		expect(baleAdapter.getMessageListRoot()).not.toBeNull();
	});

	it("isMessageNode identifies message-bubble elements", () => {
		const el = document.querySelector('[data-testid="message-bubble"]')!;
		expect(baleAdapter.isMessageNode(el)).toBe(true);
		expect(baleAdapter.isMessageNode(document.createElement("div"))).toBe(
			false,
		);
	});

	it("extractMessageText returns textContent", () => {
		const el = document.querySelector(
			'[data-testid="message-bubble"]',
		) as Element;
		expect(baleAdapter.extractMessageText(el)).toBe("سلام");
	});

	it("replaceMessageText sets text with lock emoji", () => {
		const el = document.querySelector(
			'[data-testid="message-bubble"]',
		) as Element;
		baleAdapter.replaceMessageText(el, "decrypted text");
		expect(el.textContent).toBe("🔒 decrypted text");
	});
});
