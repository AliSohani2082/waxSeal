import type { IdentityKeyPair } from "./keys.js";
import { importPublicKeyJwk, exportPublicKeyJwk } from "./keys.js";
import { generateSessionKey, wrapSessionKey, unwrapSessionKey } from "./session.js";
import type { EnvelopeFields, EncodableEnvelope } from "./envelope.js";
import { MsgType } from "./envelope.js";
import { shortKeyId } from "./fingerprint.js";
import { bytesEqual } from "./bytes.js";
import { utf8Encode, utf8Decode, base64UrlEncode, base64UrlDecode } from "./bytes.js";

const NONCE_LEN = 16;
const IV_LEN = 12;
const ZERO_SESSION_KEY_ID = new Uint8Array(8);

function randomNonce(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(NONCE_LEN));
}

function randomIv(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(IV_LEN));
}

export class HandshakeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HandshakeError";
  }
}

interface HandshakeInitPayload {
  nonce: string;
  publicKeyJwk: JsonWebKey;
}

interface HandshakeResponsePayload {
  echoedNonce: string;
  wrappedSessionKey: string;
  publicKeyJwk: JsonWebKey;
}

function packJsonPayload(obj: unknown): Uint8Array {
  return utf8Encode(JSON.stringify(obj));
}

function unpackJsonPayload<T>(bytes: Uint8Array): T {
  try {
    return JSON.parse(utf8Decode(bytes)) as T;
  } catch {
    throw new HandshakeError("malformed handshake payload JSON");
  }
}

/**
 * Drives the initiating side of a handshake (see docs/CRYPTO_DESIGN.md
 * "Handshake"). One instance per in-flight handshake attempt — create a new
 * one to retry after a failure rather than reusing a completed/failed
 * instance.
 */
export class HandshakeInitiator {
  private pendingNonce: Uint8Array | null = null;
  private completed = false;

  constructor(private readonly myKeyPair: IdentityKeyPair) {}

  async createInit(): Promise<EncodableEnvelope> {
    if (this.pendingNonce) {
      throw new HandshakeError("a handshake is already in progress on this instance");
    }
    const nonce = randomNonce();
    this.pendingNonce = nonce;

    const myPublicKeyJwk = await exportPublicKeyJwk(this.myKeyPair.publicKey);
    const senderKeyId = await shortKeyId(myPublicKeyJwk);
    const payload: HandshakeInitPayload = {
      nonce: base64UrlEncode(nonce),
      publicKeyJwk: myPublicKeyJwk,
    };

    return {
      senderKeyId,
      sessionKeyId: ZERO_SESSION_KEY_ID,
      msgType: MsgType.HANDSHAKE_INIT,
      iv: randomIv(),
      payload: packJsonPayload(payload),
    };
  }

  /**
   * Consumes a HANDSHAKE_RESPONSE. Throws if this instance never sent an
   * INIT, already completed (guards against replaying an already-consumed
   * response), or the response's echoed nonce doesn't match the one we
   * generated (guards against a stale or replayed response from a previous
   * attempt).
   */
  async handleResponse(fields: EnvelopeFields): Promise<{
    peerPublicKeyJwk: JsonWebKey;
    sessionKey: CryptoKey;
    sessionKeyId: Uint8Array;
    senderKeyId: Uint8Array;
  }> {
    if (this.completed) {
      throw new HandshakeError("handshake already completed — possible replayed response");
    }
    if (!this.pendingNonce) {
      throw new HandshakeError("no handshake in progress on this instance");
    }
    if (fields.msgType !== MsgType.HANDSHAKE_RESPONSE) {
      throw new HandshakeError(`expected HANDSHAKE_RESPONSE, got msgType ${fields.msgType}`);
    }

    const payload = unpackJsonPayload<HandshakeResponsePayload>(fields.payload);
    const echoedNonce = base64UrlDecode(payload.echoedNonce);
    if (!bytesEqual(echoedNonce, this.pendingNonce)) {
      throw new HandshakeError("nonce mismatch — possible stale or replayed response");
    }

    const wrappedSessionKey = base64UrlDecode(payload.wrappedSessionKey);
    const sessionKey = await unwrapSessionKey(wrappedSessionKey, this.myKeyPair.privateKey);

    this.completed = true;
    this.pendingNonce = null;

    return {
      peerPublicKeyJwk: payload.publicKeyJwk,
      sessionKey,
      sessionKeyId: fields.sessionKeyId,
      senderKeyId: fields.senderKeyId,
    };
  }
}

/** Drives the responding side of a handshake — stateless, one call per incoming INIT. */
export class HandshakeResponder {
  constructor(private readonly myKeyPair: IdentityKeyPair) {}

  async handleInit(fields: EnvelopeFields): Promise<{
    responseFields: EncodableEnvelope;
    peerPublicKeyJwk: JsonWebKey;
    sessionKey: CryptoKey;
    sessionKeyId: Uint8Array;
    senderKeyId: Uint8Array;
  }> {
    if (fields.msgType !== MsgType.HANDSHAKE_INIT) {
      throw new HandshakeError(`expected HANDSHAKE_INIT, got msgType ${fields.msgType}`);
    }

    const payload = unpackJsonPayload<HandshakeInitPayload>(fields.payload);
    const nonce = base64UrlDecode(payload.nonce);
    const peerPublicKey = await importPublicKeyJwk(payload.publicKeyJwk);

    const sessionKey = await generateSessionKey();
    const wrappedSessionKey = await wrapSessionKey(sessionKey, peerPublicKey);
    const sessionKeyId = crypto.getRandomValues(new Uint8Array(8));

    const myPublicKeyJwk = await exportPublicKeyJwk(this.myKeyPair.publicKey);
    const senderKeyId = await shortKeyId(myPublicKeyJwk);

    const responsePayload: HandshakeResponsePayload = {
      echoedNonce: base64UrlEncode(nonce),
      wrappedSessionKey: base64UrlEncode(wrappedSessionKey),
      publicKeyJwk: myPublicKeyJwk,
    };

    return {
      responseFields: {
        senderKeyId,
        sessionKeyId,
        msgType: MsgType.HANDSHAKE_RESPONSE,
        iv: randomIv(),
        payload: packJsonPayload(responsePayload),
      },
      peerPublicKeyJwk: payload.publicKeyJwk,
      sessionKey,
      sessionKeyId,
      senderKeyId: fields.senderKeyId,
    };
  }
}

/** Builds a SESSION_KEY_ACK envelope — sent once a handshake response has been successfully decrypted. */
export async function createSessionKeyAck(
  myPublicKeyJwk: JsonWebKey,
  sessionKeyId: Uint8Array,
): Promise<EncodableEnvelope> {
  const senderKeyId = await shortKeyId(myPublicKeyJwk);
  return {
    senderKeyId,
    sessionKeyId,
    msgType: MsgType.SESSION_KEY_ACK,
    iv: randomIv(),
    payload: new Uint8Array(0),
  };
}

/**
 * True if `incomingSenderKeyId` differs from the key id we already have on
 * file for this contact. Callers (contact storage) must treat a `true`
 * result as a key-change event requiring explicit user re-verification, not
 * a silent re-key — see docs/CRYPTO_DESIGN.md "Key-change handling".
 */
export function detectKeyChange(
  existingSenderKeyId: Uint8Array | null,
  incomingSenderKeyId: Uint8Array,
): boolean {
  if (!existingSenderKeyId) return false;
  return !bytesEqual(existingSenderKeyId, incomingSenderKeyId);
}
