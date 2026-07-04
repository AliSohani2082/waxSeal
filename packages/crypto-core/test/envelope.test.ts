import { describe, expect, it } from "vitest";
import { base64UrlEncode } from "../src/bytes.js";
import {
	containsEnvelopeMarker,
	decodeEnvelope,
	EnvelopeDecodeError,
	encodeEnvelope,
	findEnvelopeToken,
	MARKER,
	MsgType,
	WIRE_VERSION,
} from "../src/envelope.js";

function randomBytes(len: number): Uint8Array {
	return crypto.getRandomValues(new Uint8Array(len));
}

/** Fixed-header length per docs/WIRE_FORMAT.md: version(1) + senderKeyId(8) + sessionKeyId(8) + msgType(1) + iv(12). */
const FIXED_HEADER_LEN = 1 + 8 + 8 + 1 + 12;

/** Builds a syntactically-valid-length raw envelope by hand, bypassing encodeEnvelope's
 *  own validation, so decodeEnvelope's own field-level checks (version, msgType) can be
 *  exercised directly. */
function buildRawToken(opts: { version?: number; msgType?: number }): string {
	const header = new Uint8Array(FIXED_HEADER_LEN);
	header[0] = opts.version ?? WIRE_VERSION;
	header.set(randomBytes(8), 1);
	header.set(randomBytes(8), 9);
	header[17] = opts.msgType ?? MsgType.DATA;
	header.set(randomBytes(12), 18);
	return MARKER + base64UrlEncode(header);
}

describe("encodeEnvelope / decodeEnvelope", () => {
	it("round-trips all fields for a DATA envelope", () => {
		const fields = {
			senderKeyId: randomBytes(8),
			sessionKeyId: randomBytes(8),
			msgType: MsgType.DATA,
			iv: randomBytes(12),
			payload: randomBytes(40),
		};
		const token = encodeEnvelope(fields);
		expect(token.startsWith(MARKER)).toBe(true);
		const decoded = decodeEnvelope(token);
		expect(decoded.version).toBe(WIRE_VERSION);
		expect(decoded.senderKeyId).toEqual(fields.senderKeyId);
		expect(decoded.sessionKeyId).toEqual(fields.sessionKeyId);
		expect(decoded.msgType).toBe(fields.msgType);
		expect(decoded.iv).toEqual(fields.iv);
		expect(decoded.payload).toEqual(fields.payload);
	});

	it("round-trips an empty payload", () => {
		const fields = {
			senderKeyId: randomBytes(8),
			sessionKeyId: new Uint8Array(8),
			msgType: MsgType.SESSION_KEY_ACK,
			iv: randomBytes(12),
			payload: new Uint8Array(0),
		};
		const decoded = decodeEnvelope(encodeEnvelope(fields));
		expect(decoded.payload).toEqual(new Uint8Array(0));
	});

	it("throws EnvelopeDecodeError when senderKeyId has the wrong length", () => {
		const fields = {
			senderKeyId: randomBytes(7),
			sessionKeyId: randomBytes(8),
			msgType: MsgType.DATA,
			iv: randomBytes(12),
			payload: randomBytes(4),
		};
		expect(() => encodeEnvelope(fields)).toThrow(EnvelopeDecodeError);
	});

	it("throws EnvelopeDecodeError when sessionKeyId has the wrong length", () => {
		const fields = {
			senderKeyId: randomBytes(8),
			sessionKeyId: randomBytes(9),
			msgType: MsgType.DATA,
			iv: randomBytes(12),
			payload: randomBytes(4),
		};
		expect(() => encodeEnvelope(fields)).toThrow(EnvelopeDecodeError);
	});

	it("throws EnvelopeDecodeError when iv has the wrong length", () => {
		const fields = {
			senderKeyId: randomBytes(8),
			sessionKeyId: randomBytes(8),
			msgType: MsgType.DATA,
			iv: randomBytes(11),
			payload: randomBytes(4),
		};
		expect(() => encodeEnvelope(fields)).toThrow(EnvelopeDecodeError);
	});
});

describe("decodeEnvelope failure modes", () => {
	it("rejects a token missing the marker prefix", () => {
		expect(() => decodeEnvelope("not-a-waxseal-token")).toThrow(
			EnvelopeDecodeError,
		);
	});

	it("rejects invalid base64url after the marker", () => {
		expect(() => decodeEnvelope(MARKER + "not valid!")).toThrow(
			EnvelopeDecodeError,
		);
	});

	it("rejects an envelope shorter than the fixed header", () => {
		const short = MARKER + base64UrlEncode(randomBytes(5));
		expect(() => decodeEnvelope(short)).toThrow(EnvelopeDecodeError);
	});

	it("rejects an unsupported wire version", () => {
		expect(() => decodeEnvelope(buildRawToken({ version: 99 }))).toThrow(
			EnvelopeDecodeError,
		);
	});

	it("rejects an unknown msgType byte", () => {
		expect(() => decodeEnvelope(buildRawToken({ msgType: 255 }))).toThrow(
			EnvelopeDecodeError,
		);
	});
});

describe("containsEnvelopeMarker", () => {
	it("detects the marker anywhere in a string", () => {
		expect(containsEnvelopeMarker(`hey ${MARKER}abc123 there`)).toBe(true);
		expect(containsEnvelopeMarker("no marker here")).toBe(false);
	});
});

describe("findEnvelopeToken", () => {
	it("extracts the token from surrounding text", () => {
		const fields = {
			senderKeyId: randomBytes(8),
			sessionKeyId: randomBytes(8),
			msgType: MsgType.DATA,
			iv: randomBytes(12),
			payload: randomBytes(4),
		};
		const token = encodeEnvelope(fields);
		const wrapped = `hey check this out: ${token}!! cool right?`;
		expect(findEnvelopeToken(wrapped)).toBe(token);
	});

	it("returns null when no marker is present", () => {
		expect(findEnvelopeToken("just a normal chat message")).toBeNull();
	});
});
