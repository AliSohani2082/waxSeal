import type { BackgroundRequest, BackgroundResponse } from "./protocol.js";

export function sendToBackground(req: BackgroundRequest): Promise<BackgroundResponse> {
  return chrome.runtime.sendMessage(req) as Promise<BackgroundResponse>;
}

export async function getActiveTabId(): Promise<number | null> {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs[0]?.id ?? null);
    });
  });
}

export async function refresh(tabId: number): Promise<void> {
  const statusEl = document.getElementById("status")!;
  const safetyEl = document.getElementById("safety-number")!;
  const startBtn = document.getElementById("start-btn") as HTMLButtonElement;
  const warningEl = document.getElementById("key-change-warning")!;

  const ctx = await sendToBackground({ type: "GET_CONTEXT" });
  if (!ctx.ok || ctx.type !== "CONTEXT") return;

  statusEl.className = ctx.state.toLowerCase();
  statusEl.textContent = `Status: ${ctx.state}`;

  startBtn.disabled = ctx.state === "PENDING";

  if (ctx.state === "ACTIVE") {
    const snRes = await sendToBackground({ type: "GET_SAFETY_NUMBER" });
    if (snRes.ok && snRes.type === "SAFETY_NUMBER") {
      safetyEl.textContent = `Safety number:\n${snRes.number}`;
      safetyEl.style.display = "block";
    }
  } else {
    safetyEl.style.display = "none";
  }

  // Key-change warning: stored in sessionStorage by the content script
  const hasKeyChange = sessionStorage.getItem(`waxseal-key-change-${tabId}`) === "true";
  warningEl.style.display = hasKeyChange ? "block" : "none";
}

export async function init(): Promise<void> {
  const notBaleEl = document.getElementById("not-bale")!;
  const mainEl = document.getElementById("main")!;
  const startBtn = document.getElementById("start-btn") as HTMLButtonElement;

  const tabId = await getActiveTabId();
  if (!tabId) {
    notBaleEl.style.display = "block";
    return;
  }

  // Check if the tab is a Bale page
  chrome.tabs.get(tabId, (tab) => {
    const isBale = tab.url?.includes("web.bale.ai") ?? false;
    if (!isBale) {
      notBaleEl.style.display = "block";
      return;
    }
    mainEl.style.display = "block";
    refresh(tabId).catch(console.error);

    startBtn.addEventListener("click", async () => {
      startBtn.disabled = true;
      await sendToBackground({ type: "INITIATE_HANDSHAKE" });
      await refresh(tabId);
    });
  });
}

// Auto-start in production when loaded as the popup page
if (typeof document !== "undefined" && typeof chrome !== "undefined" && chrome.tabs) {
  document.addEventListener("DOMContentLoaded", () => {
    init().catch(console.error);
  });
}
