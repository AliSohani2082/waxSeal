import {
	Base64UrlDecodeError,
	base64UrlDecode,
	base64UrlEncode,
	concatBytes,
} from "./bytes.js";

/** See docs/WIRE_FORMAT.md — this constant and the field layout below must match that doc. */
export const MARKER = "⁉WAXSEAL1:";

export const WIRE_VERSION = 1;

export const MsgType = {
	DATA: 0,
	HANDSHAKE_INIT: 1,
	HANDSHAKE_RESPONSE: 2,
	SESSION_KEY_ROTATE: 3,
	SESSION_KEY_ACK: 4,
} as const;
export type MsgType = (typeof MsgType)[keyof typeof MsgType];

const KEY_ID_LEN = 8;
const IV_LEN = 12;
// version(1) + senderKeyId(8) + sessionKeyId(8) + msgType(1) + iv(12)
const FIXED_HEADER_LEN = 1 + KEY_ID_LEN + KEY_ID_LEN + 1 + IV_LEN;

export interface EnvelopeFields {
	version: number;
	senderKeyId: Uint8Array;
	sessionKeyId: Uint8Array;
	msgType: MsgType;
	iv: Uint8Array;
	payload: Uint8Array;
}

/** Fields needed to encode a new envelope — `version` is stamped in by encodeEnvelope itself. */
export type EncodableEnvelope = Omit<EnvelopeFields, "version">;

export class EnvelopeDecodeError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "EnvelopeDecodeError";
	}
}

function assertLen(name: string, bytes: Uint8Array, expected: number): void {
	if (bytes.length !== expected) {
		throw new EnvelopeDecodeError(
			`${name} must be ${expected} bytes, got ${bytes.length}`,
		);
	}
}

/** Encodes envelope fields into the full `<marker><base64url>` wire token. */
export function encodeEnvelope(fields: EncodableEnvelope): string {
	assertLen("senderKeyId", fields.senderKeyId, KEY_ID_LEN);
	assertLen("sessionKeyId", fields.sessionKeyId, KEY_ID_LEN);
	assertLen("iv", fields.iv, IV_LEN);

	const header = new Uint8Array(FIXED_HEADER_LEN);
	header[0] = WIRE_VERSION;
	header.set(fields.senderKeyId, 1);
	header.set(fields.sessionKeyId, 1 + KEY_ID_LEN);
	header[1 + KEY_ID_LEN + KEY_ID_LEN] = fields.msgType;
	header.set(fields.iv, 1 + KEY_ID_LEN + KEY_ID_LEN + 1);

	const bytes = concatBytes(header, fields.payload);
	return MARKER + base64UrlEncode(bytes);
}

/** True if `text` contains the waxseal marker anywhere — a cheap pre-check before full decode. */
export function containsEnvelopeMarker(text: string): boolean {
	return text.includes(MARKER);
}

/**
 * Extracts the first contiguous waxseal token from arbitrary surrounding
 * text (host chat UIs may wrap ciphertext with other characters). Returns
 * null if no marker is present at all — callers should treat that as "not
 * our message," not as a decode failure.
 */
export function findEnvelopeToken(text: string): string | null {
	const markerIndex = text.indexOf(MARKER);
	if (markerIndex === -1) return null;
	const afterMarker = text.slice(markerIndex + MARKER.length);
	const match = /^[A-Za-z0-9\-_]+/.exec(afterMarker);
	if (!match) return null;
	return MARKER + match[0];
}

/**
 * Decodes a full `<marker><base64url>` token. Throws EnvelopeDecodeError on
 * any malformed input — callers must treat that as "could not decrypt,"
 * never attempt to recover a partial/garbage plaintext from it.
 */
export function decodeEnvelope(token: string): EnvelopeFields {
	if (!token.startsWith(MARKER)) {
		throw new EnvelopeDecodeError(
			"token does not start with the waxseal marker",
		);
	}
	const encoded = token.slice(MARKER.length);

	let bytes: Uint8Array;
	try {
		bytes = base64UrlDecode(encoded);
	} catch (err) {
		if (err instanceof Base64UrlDecodeError) {
			throw new EnvelopeDecodeError(
				`invalid base64url payload: ${err.message}`,
			);
		}
		throw err;
	}

	if (bytes.length < FIXED_HEADER_LEN) {
		throw new EnvelopeDecodeError(
			`envelope too short: ${bytes.length} bytes, need at least ${FIXED_HEADER_LEN}`,
		);
	}

	const version = bytes[0]!;
	if (version !== WIRE_VERSION) {
		throw new EnvelopeDecodeError(`unsupported wire version: ${version}`);
	}

	const senderKeyId = bytes.slice(1, 1 + KEY_ID_LEN);
	const sessionKeyId = bytes.slice(1 + KEY_ID_LEN, 1 + KEY_ID_LEN * 2);
	const msgTypeByte = bytes[1 + KEY_ID_LEN * 2]!;
	if (!Object.values(MsgType).includes(msgTypeByte as MsgType)) {
		throw new EnvelopeDecodeError(`unknown msgType: ${msgTypeByte}`);
	}
	const ivStart = 1 + KEY_ID_LEN * 2 + 1;
	const iv = bytes.slice(ivStart, ivStart + IV_LEN);
	const payload = bytes.slice(ivStart + IV_LEN);

	return {
		version,
		senderKeyId,
		sessionKeyId,
		msgType: msgTypeByte as MsgType,
		iv,
		payload,
	};
}
