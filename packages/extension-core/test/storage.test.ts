import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { NonExtractableKeyStore } from "../src/storage.js";

describe("NonExtractableKeyStore", () => {
	let store: NonExtractableKeyStore;

	beforeEach(() => {
		store = new NonExtractableKeyStore();
	});

	it("returns null when no key has been saved", async () => {
		const result = await store.loadIdentityKey();
		expect(result).toBeNull();
	});

	it("saves and loads a key pair", async () => {
		const pair = (await crypto.subtle.generateKey(
			{
				name: "RSA-OAEP",
				modulusLength: 2048,
				publicExponent: new Uint8Array([1, 0, 1]),
				hash: "SHA-256",
			},
			true,
			["wrapKey", "unwrapKey"],
		)) as CryptoKeyPair;

		await store.saveIdentityKey(pair);
		const loaded = await store.loadIdentityKey();
		expect(loaded).not.toBeNull();
		expect(loaded?.publicKey.type).toBe("public");
		expect(loaded?.privateKey.type).toBe("private");
		expect(loaded?.privateKey.extractable).toBe(false);
	});

	it("loaded private key is non-extractable", async () => {
		const pair = (await crypto.subtle.generateKey(
			{
				name: "RSA-OAEP",
				modulusLength: 2048,
				publicExponent: new Uint8Array([1, 0, 1]),
				hash: "SHA-256",
			},
			true,
			["wrapKey", "unwrapKey"],
		)) as CryptoKeyPair;

		await store.saveIdentityKey(pair);
		const loaded = await store.loadIdentityKey();
		await expect(
			crypto.subtle.exportKey("jwk", loaded?.privateKey),
		).rejects.toThrow();
	});
});
