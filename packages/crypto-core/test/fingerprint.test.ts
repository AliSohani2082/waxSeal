import { describe, expect, it } from "vitest";
import {
	combinedSafetyNumber,
	fingerprintPublicKey,
	formatFingerprint,
	shortKeyId,
} from "../src/fingerprint.js";
import { exportPublicKeyJwk, generateIdentityKeyPair } from "../src/keys.js";

describe("fingerprintPublicKey", () => {
	it("is deterministic for the same JWK", async () => {
		const { publicKey } = await generateIdentityKeyPair();
		const jwk = await exportPublicKeyJwk(publicKey);
		const a = await fingerprintPublicKey(jwk);
		const b = await fingerprintPublicKey(jwk);
		expect(a).toEqual(b);
	});

	it("is independent of JWK property ordering", async () => {
		const jwkA = { kty: "RSA", n: "abc", e: "AQAB" } as JsonWebKey;
		const jwkB = { e: "AQAB", n: "abc", kty: "RSA" } as JsonWebKey;
		expect(await fingerprintPublicKey(jwkA)).toEqual(
			await fingerprintPublicKey(jwkB),
		);
	});

	it("differs for different keys", async () => {
		const { publicKey: pubA } = await generateIdentityKeyPair();
		const { publicKey: pubB } = await generateIdentityKeyPair();
		const fpA = await fingerprintPublicKey(await exportPublicKeyJwk(pubA));
		const fpB = await fingerprintPublicKey(await exportPublicKeyJwk(pubB));
		expect(fpA).not.toEqual(fpB);
	});

	it("produces a 32-byte SHA-256 digest", async () => {
		const { publicKey } = await generateIdentityKeyPair();
		const fp = await fingerprintPublicKey(await exportPublicKeyJwk(publicKey));
		expect(fp.length).toBe(32);
	});
});

describe("shortKeyId", () => {
	it("is the first 8 bytes of the full fingerprint", async () => {
		const { publicKey } = await generateIdentityKeyPair();
		const jwk = await exportPublicKeyJwk(publicKey);
		const full = await fingerprintPublicKey(jwk);
		const short = await shortKeyId(jwk);
		expect(short).toEqual(full.slice(0, 8));
	});
});

describe("formatFingerprint", () => {
	it("formats an all-zero fingerprint as sixteen zero-groups", () => {
		const zero = new Uint8Array(32);
		expect(formatFingerprint(zero)).toBe(Array(16).fill("00000").join(" "));
	});

	it("respects a custom groupSize for the digit chunking", () => {
		const zero = new Uint8Array(32);
		const formatted = formatFingerprint(zero, 10);
		expect(formatted.split(" ").every((chunk) => chunk.length <= 10)).toBe(
			true,
		);
	});
});

describe("combinedSafetyNumber", () => {
	it("is identical regardless of argument order", async () => {
		const { publicKey: pubA } = await generateIdentityKeyPair();
		const { publicKey: pubB } = await generateIdentityKeyPair();
		const fpA = await fingerprintPublicKey(await exportPublicKeyJwk(pubA));
		const fpB = await fingerprintPublicKey(await exportPublicKeyJwk(pubB));
		expect(combinedSafetyNumber(fpA, fpB)).toBe(combinedSafetyNumber(fpB, fpA));
	});
});
