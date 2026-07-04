import { describe, expect, it } from "vitest";
import {
	exportPrivateKeyJwk,
	exportPublicKeyJwk,
	generateIdentityKeyPair,
	importPrivateKeyJwk,
	importPublicKeyJwk,
} from "../src/keys.js";

describe("generateIdentityKeyPair", () => {
	it("generates an extractable keypair by default", async () => {
		const { publicKey, privateKey } = await generateIdentityKeyPair();
		expect(publicKey.extractable).toBe(true);
		expect(privateKey.extractable).toBe(true);
		expect(publicKey.type).toBe("public");
		expect(privateKey.type).toBe("private");
	});

	it("respects extractable=false for both keys in the pair", async () => {
		const { privateKey } = await generateIdentityKeyPair(false);
		expect(privateKey.extractable).toBe(false);
		await expect(exportPrivateKeyJwk(privateKey)).rejects.toThrow();
	});
});

describe("public key JWK export/import", () => {
	it("round-trips a public key through JWK", async () => {
		const { publicKey } = await generateIdentityKeyPair();
		const jwk = await exportPublicKeyJwk(publicKey);
		expect(jwk.kty).toBe("RSA");
		const imported = await importPublicKeyJwk(jwk);
		expect(imported.type).toBe("public");
		expect(imported.usages).toContain("wrapKey");
	});
});

describe("private key JWK export/import", () => {
	it("round-trips an extractable private key through JWK", async () => {
		const { privateKey } = await generateIdentityKeyPair(true);
		const jwk = await exportPrivateKeyJwk(privateKey);
		expect(jwk.kty).toBe("RSA");
		const imported = await importPrivateKeyJwk(jwk, true);
		expect(imported.type).toBe("private");
		expect(imported.extractable).toBe(true);
	});

	it("imports as non-extractable by default", async () => {
		const { privateKey } = await generateIdentityKeyPair(true);
		const jwk = await exportPrivateKeyJwk(privateKey);
		const imported = await importPrivateKeyJwk(jwk);
		expect(imported.extractable).toBe(false);
		await expect(exportPrivateKeyJwk(imported)).rejects.toThrow();
	});
});
