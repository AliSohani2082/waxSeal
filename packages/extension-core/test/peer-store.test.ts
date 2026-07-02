import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import { PeerStore } from "../src/peer-store.js";

describe("PeerStore", () => {
  let store: PeerStore;

  beforeEach(() => {
    store = new PeerStore();
  });

  it("returns null for an unknown peer", async () => {
    const result = await store.get("deadbeef01020304");
    expect(result).toBeNull();
  });

  it("saves and retrieves a peer record", async () => {
    const key = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"],
    );
    await store.save({
      senderKeyIdHex: "aabbccdd11223344",
      peerPublicKeyJwk: { kty: "RSA", n: "fake" } as JsonWebKey,
      sessionKey: key,
      sessionKeyIdB64: "abc123",
      handshakeState: "ACTIVE",
      pendingNonceB64: null,
    });
    const rec = await store.get("aabbccdd11223344");
    expect(rec).not.toBeNull();
    expect(rec!.handshakeState).toBe("ACTIVE");
    expect(rec!.sessionKeyIdB64).toBe("abc123");
    expect(rec!.sessionKey).toStrictEqual(key);
  });

  it("updates existing peer state", async () => {
    await store.save({
      senderKeyIdHex: "1234567890abcdef",
      peerPublicKeyJwk: { kty: "RSA" } as JsonWebKey,
      sessionKey: null,
      sessionKeyIdB64: null,
      handshakeState: "PENDING",
      pendingNonceB64: "nonce-value",
    });
    await store.save({
      senderKeyIdHex: "1234567890abcdef",
      peerPublicKeyJwk: { kty: "RSA" } as JsonWebKey,
      sessionKey: null,
      sessionKeyIdB64: null,
      handshakeState: "ACTIVE",
      pendingNonceB64: null,
    });
    const rec = await store.get("1234567890abcdef");
    expect(rec!.handshakeState).toBe("ACTIVE");
    expect(rec!.pendingNonceB64).toBeNull();
  });
});
