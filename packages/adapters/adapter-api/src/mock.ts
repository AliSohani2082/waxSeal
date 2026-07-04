import type { SiteAdapter } from "./index.js";

export class MockSiteAdapter implements SiteAdapter {
  id = "mock";

  private composerEl: Element;
  private listRoot: Element;
  lastInjectedText: string | null = null;
  sendTriggeredCount = 0;

  constructor() {
    this.composerEl = document.createElement("div");
    this.composerEl.setAttribute("contenteditable", "true");
    this.listRoot = document.createElement("div");
    this.listRoot.setAttribute("data-testid", "message-list");
    document.body.appendChild(this.composerEl);
    document.body.appendChild(this.listRoot);
  }

  matches(_url: string): boolean { return true; }

  getComposerElement(): Element { return this.composerEl; }

  getSendTrigger(): { type: "enter" } { return { type: "enter" }; }

  injectOutgoingText(el: Element, ciphertext: string): void {
    this.lastInjectedText = ciphertext;
    el.textContent = ciphertext;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }

  triggerSend(_el: Element): void {
    this.sendTriggeredCount++;
  }

  getMessageListRoot(): Element { return this.listRoot; }

  isMessageNode(node: Node): boolean {
    return node instanceof Element && node.getAttribute("data-testid") === "message-bubble";
  }

  extractMessageText(node: Element): string { return node.textContent ?? ""; }

  replaceMessageText(node: Element, plaintext: string): void {
    node.textContent = `🔒 ${plaintext}`;
  }

  createMessageNode(text: string): Node {
    const el = document.createElement("div");
    el.setAttribute("data-testid", "message-bubble");
    el.textContent = text;
    this.listRoot.appendChild(el);
    return el;
  }
}
