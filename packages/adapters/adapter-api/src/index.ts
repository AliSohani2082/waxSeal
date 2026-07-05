export interface SiteAdapter {
	id: string;
	matches(url: string): boolean;
	getComposerElement(): Element | null;
	getSendTrigger(): { type: "enter" };
	injectOutgoingText(el: Element, ciphertext: string): void;
	triggerSend(el: Element): void;
	getMessageListRoot(): Element | null;
	isMessageNode(node: Node): boolean;
	extractMessageText(node: Element): string;
	replaceMessageText(node: Element, plaintext: string): void;
}

export { MockSiteAdapter } from "./mock.js";
