import { describe, expect, it } from "vitest";
import {
	Base64UrlDecodeError,
	base64UrlDecode,
	base64UrlEncode,
	bytesEqual,
	concatBytes,
	utf8Decode,
	utf8Encode,
} from "../src/bytes.js";

describe("base64UrlEncode / base64UrlDecode", () => {
	it("round-trips byte arrays of every padding length (0-5 bytes)", () => {
		for (let len = 0; len <= 5; len++) {
			const bytes = crypto.getRandomValues(new Uint8Array(len));
			const encoded = base64UrlEncode(bytes);
			expect(base64UrlDecode(encoded)).toEqual(bytes);
		}
	});

	it("matches a known vector", () => {
		const bytes = utf8Encode("Hello");
		expect(base64UrlEncode(bytes)).toBe("SGVsbG8");
	});

	it("decodes a known vector back to the original text", () => {
		const decoded = base64UrlDecode("SGVsbG8");
		expect(utf8Decode(decoded)).toBe("Hello");
	});

	it("produces no padding characters or internal whitespace", () => {
		const bytes = crypto.getRandomValues(new Uint8Array(37));
		const encoded = base64UrlEncode(bytes);
		expect(encoded).not.toMatch(/[=\s+/]/);
	});

	it("throws Base64UrlDecodeError on characters outside the alphabet", () => {
		expect(() => base64UrlDecode("not-valid-b64!")).toThrow(
			Base64UrlDecodeError,
		);
		expect(() => base64UrlDecode("has spaces")).toThrow(Base64UrlDecodeError);
		expect(() => base64UrlDecode("has+plus")).toThrow(Base64UrlDecodeError);
	});
});

describe("utf8Encode / utf8Decode", () => {
	it("round-trips ASCII text", () => {
		expect(utf8Decode(utf8Encode("hello world"))).toBe("hello world");
	});

	it("round-trips multi-byte text (accents, emoji, non-Latin scripts)", () => {
		const text = "héllo 🔒 世界";
		expect(utf8Decode(utf8Encode(text))).toBe(text);
	});

	it("throws on malformed UTF-8 bytes (fatal decoding)", () => {
		const invalid = new Uint8Array([0x80]); // lone continuation byte, invalid on its own
		expect(() => utf8Decode(invalid)).toThrow();
	});
});

describe("concatBytes", () => {
	it("concatenates multiple chunks in order", () => {
		const result = concatBytes(
			new Uint8Array([1, 2]),
			new Uint8Array([3]),
			new Uint8Array([4, 5]),
		);
		expect(result).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
	});

	it("handles empty and zero chunks", () => {
		expect(concatBytes()).toEqual(new Uint8Array(0));
		expect(concatBytes(new Uint8Array(0), new Uint8Array([9]))).toEqual(
			new Uint8Array([9]),
		);
	});
});

describe("bytesEqual", () => {
	it("returns true for identical content", () => {
		expect(
			bytesEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3])),
		).toBe(true);
	});

	it("returns false for different lengths", () => {
		expect(bytesEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3]))).toBe(
			false,
		);
	});

	it("returns false for same length but different content", () => {
		expect(
			bytesEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4])),
		).toBe(false);
	});

	it("returns true for two empty arrays", () => {
		expect(bytesEqual(new Uint8Array(0), new Uint8Array(0))).toBe(true);
	});
});
