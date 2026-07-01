/**
 * Identity keypair generation and JWK import/export.
 *
 * This module never persists anything — storage (including the
 * non-extractable-key-in-IndexedDB pattern described in docs/CRYPTO_DESIGN.md)
 * is the responsibility of the extension-core key manager, not crypto-core.
 */

export const RSA_OAEP_PARAMS = {
  name: "RSA-OAEP",
  modulusLength: 3072,
  publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
  hash: "SHA-256",
} as const;

export interface IdentityKeyPair {
  publicKey: CryptoKey;
  privateKey: CryptoKey;
}

/**
 * Generates a new RSA-OAEP identity keypair.
 *
 * `extractable` defaults to true because the public key must always be
 * exportable to share with a peer, and Web Crypto's generateKey applies one
 * extractable flag to both keys in a pair. Callers that want a
 * non-extractable long-term private key should export it once via
 * exportPrivateKeyJwk and re-import via importPrivateKeyJwk with
 * extractable=false (see extension-core keyManager).
 */
// Identity keys are only ever used to wrap/unwrap a symmetric session key
// (see session.ts), never to encrypt arbitrary data directly, so they are
// generated with the narrower wrapKey/unwrapKey usages rather than
// encrypt/decrypt.
export async function generateIdentityKeyPair(extractable = true): Promise<IdentityKeyPair> {
  const keyPair = (await crypto.subtle.generateKey(RSA_OAEP_PARAMS, extractable, [
    "wrapKey",
    "unwrapKey",
  ])) as CryptoKeyPair;
  return { publicKey: keyPair.publicKey, privateKey: keyPair.privateKey };
}

export async function exportPublicKeyJwk(publicKey: CryptoKey): Promise<JsonWebKey> {
  return crypto.subtle.exportKey("jwk", publicKey);
}

export async function importPublicKeyJwk(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey("jwk", jwk, { name: "RSA-OAEP", hash: "SHA-256" }, true, [
    "wrapKey",
  ]);
}

export async function exportPrivateKeyJwk(privateKey: CryptoKey): Promise<JsonWebKey> {
  return crypto.subtle.exportKey("jwk", privateKey);
}

export async function importPrivateKeyJwk(
  jwk: JsonWebKey,
  extractable = false,
): Promise<CryptoKey> {
  return crypto.subtle.importKey("jwk", jwk, { name: "RSA-OAEP", hash: "SHA-256" }, extractable, [
    "unwrapKey",
  ]);
}
