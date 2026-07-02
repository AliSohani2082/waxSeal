import "fake-indexeddb/auto";
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock chrome APIs before importing background
const mockSendMessage = vi.fn();
const mockOnMessage = { addListener: vi.fn() };
globalThis.chrome = {
  runtime: { onMessage: mockOnMessage, sendMessage: vi.fn() },
  tabs: { sendMessage: mockSendMessage },
} as unknown as typeof chrome;

import { handleMessage } from "../src/background.js";
import {
  generateIdentityKeyPair, exportPublicKeyJwk,
  HandshakeInitiator, HandshakeResponder, createSessionKeyAck,
  encodeEnvelope, decodeEnvelope, MsgType,
  encryptMessage, utf8Encode, base64UrlEncode, shortKeyId,
} from "@waxseal/crypto-core";

async function makeKeyPair() {
  return generateIdentityKeyPair(true);
}

describe("background handleMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("ENCRYPT returns NO_SESSION before any handshake", async () => {
    const res = await handleMessage({ type: "ENCRYPT", plaintext: "hello", peerKeyIdHex: "0000000000000000" }, 1);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("NO_SESSION");
  });

  it("GET_STATUS returns IDLE for unknown peer", async () => {
    const res = await handleMessage({ type: "GET_STATUS" }, 1);
    expect(res).toEqual({ ok: true, type: "STATUS", state: "IDLE" });
  });

  it("GET_CONTEXT returns null peer when no session", async () => {
    const res = await handleMessage({ type: "GET_CONTEXT" }, 99);
    expect(res).toEqual({ ok: true, type: "CONTEXT", peerKeyIdHex: null, state: "IDLE" });
  });

  it("full handshake: INITIATE then receive RESPONSE reaches ACTIVE state", async () => {
    const tabId = 101;

    // Step 1: initiator triggers INITIATE_HANDSHAKE
    const initRes = await handleMessage({ type: "INITIATE_HANDSHAKE" }, tabId);
    expect(initRes).toMatchObject({ ok: true, type: "HANDSHAKE_INJECTED" });

    // Step 2: simulate peer responding
    const peer = await makeKeyPair();
    const peerPublicKeyJwk = await exportPublicKeyJwk(peer.publicKey);
    const injectedEnvelopeB64 = mockSendMessage.mock.calls.at(-1)?.[1].envelopeB64 as string;
    expect(injectedEnvelopeB64).toBeTruthy();

    const initFields = decodeEnvelope(injectedEnvelopeB64);
    expect(initFields.msgType).toBe(MsgType.HANDSHAKE_INIT);

    const responder = new HandshakeResponder(peer);
    const { responseFields } = await responder.handleInit(initFields);
    const responseEnvelope = encodeEnvelope(responseFields);

    // Step 3: feed HANDSHAKE_RESPONSE back to background
    const decryptRes = await handleMessage({ type: "DECRYPT", envelopeB64: responseEnvelope }, tabId);
    expect(decryptRes).toMatchObject({ ok: true, type: "HANDSHAKE_INJECTED" });

    // Step 4: session should now be ACTIVE
    const statusRes = await handleMessage({ type: "GET_STATUS" }, tabId);
    expect(statusRes).toEqual({ ok: true, type: "STATUS", state: "ACTIVE" });
  });

  it("ENCRYPT and DECRYPT round-trip after active session", async () => {
    const tabId = 102;
    const peer = await makeKeyPair();

    // Initiate handshake
    await handleMessage({ type: "INITIATE_HANDSHAKE" }, tabId);
    const injectedEnvelope = mockSendMessage.mock.calls.at(-1)?.[1].envelopeB64 as string;
    const initFields = decodeEnvelope(injectedEnvelope);
    const responder = new HandshakeResponder(peer);
    const { responseFields } = await responder.handleInit(initFields);
    await handleMessage({ type: "DECRYPT", envelopeB64: encodeEnvelope(responseFields) }, tabId);

    // Get peer key id from context
    const ctx = await handleMessage({ type: "GET_CONTEXT" }, tabId);
    expect(ctx.ok).toBe(true);
    if (!ctx.ok) throw new Error();
    if (ctx.type !== "CONTEXT") throw new Error();
    const peerKeyIdHex = ctx.peerKeyIdHex!;

    // Encrypt
    const encRes = await handleMessage({ type: "ENCRYPT", plaintext: "secret message", peerKeyIdHex }, tabId);
    expect(encRes.ok).toBe(true);
    if (!encRes.ok) throw new Error();
    if (encRes.type !== "ENCRYPTED") throw new Error();

    // Decrypt what we encrypted — same background session key on both ends
    const decRes = await handleMessage({ type: "DECRYPT", envelopeB64: encRes.envelopeB64 }, tabId);
    // We encrypted it, so background can decrypt with the same session key
    expect(decRes.ok).toBe(true);
    if (!decRes.ok) throw new Error();
    if (decRes.type !== "DECRYPTED") throw new Error();
    expect(decRes.plaintext).toBe("secret message");
  });

  it("returns KEY_CHANGE_DETECTED when a new HANDSHAKE_INIT arrives on active tab", async () => {
    const tabId = 103;

    // Establish a session
    await handleMessage({ type: "INITIATE_HANDSHAKE" }, tabId);
    const injectedEnvelope = mockSendMessage.mock.calls.at(-1)?.[1].envelopeB64 as string;
    const initFields = decodeEnvelope(injectedEnvelope);
    const peer1 = await makeKeyPair();
    const responder1 = new HandshakeResponder(peer1);
    const { responseFields } = await responder1.handleInit(initFields);
    await handleMessage({ type: "DECRYPT", envelopeB64: encodeEnvelope(responseFields) }, tabId);

    // A different peer sends HANDSHAKE_INIT to the same tab
    const peer2 = await makeKeyPair();
    const initiator2 = new HandshakeInitiator(peer2);
    const initEnvelope2 = await initiator2.createInit();
    const res = await handleMessage({ type: "DECRYPT", envelopeB64: encodeEnvelope(initEnvelope2) }, tabId);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("KEY_CHANGE_DETECTED");
  });
});
