export type HandshakeState = "IDLE" | "PENDING" | "ACTIVE";

export type BackgroundRequest =
  | { type: "ENCRYPT"; plaintext: string; peerKeyIdHex: string }
  | { type: "DECRYPT"; envelopeB64: string }
  | { type: "INITIATE_HANDSHAKE" }
  | { type: "GET_STATUS" }
  | { type: "GET_SAFETY_NUMBER" }
  | { type: "GET_CONTEXT" };

export type BackgroundResponse =
  | { ok: true; type: "ENCRYPTED"; envelopeB64: string }
  | { ok: true; type: "DECRYPTED"; plaintext: string; peerKeyIdHex: string }
  | { ok: true; type: "HANDSHAKE_INJECTED" }
  | { ok: true; type: "STATUS"; state: HandshakeState }
  | { ok: true; type: "SAFETY_NUMBER"; number: string }
  | { ok: true; type: "CONTEXT"; peerKeyIdHex: string | null; state: HandshakeState }
  | { ok: false; error: "NO_SESSION" | "DECRYPT_FAILED" | "KEY_CHANGE_DETECTED" | "NO_PEER" };

export type ContentScriptMessage =
  | { type: "INJECT_ENVELOPE"; envelopeB64: string };
