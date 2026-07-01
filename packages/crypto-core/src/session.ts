const AES_GCM_PARAMS = { name: "AES-GCM", length: 256 } as const;
const IV_LENGTH_BYTES = 12;

/**
 * Generates a random AES-256-GCM session key. Extractable, because wrapping
 * it under a peer's RSA public key (see wrapSessionKey) requires it — Web
 * Crypto's wrapKey operation throws on a non-extractable key.
 */
export async function generateSessionKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(AES_GCM_PARAMS, true, ["encrypt", "decrypt"]);
}

/** RSA-OAEP-wraps a session key's raw bytes under the peer's public key. */
export async function wrapSessionKey(
  sessionKey: CryptoKey,
  peerPublicKey: CryptoKey,
): Promise<Uint8Array> {
  const wrapped = await crypto.subtle.wrapKey("raw", sessionKey, peerPublicKey, {
    name: "RSA-OAEP",
  });
  return new Uint8Array(wrapped);
}

/**
 * Unwraps a session key using our RSA private key. The resulting key is
 * non-extractable by default since, unlike the wrapping side, we never need
 * to re-export it — it's used directly for AES-GCM encrypt/decrypt.
 */
export async function unwrapSessionKey(
  wrapped: Uint8Array,
  myPrivateKey: CryptoKey,
  extractable = false,
): Promise<CryptoKey> {
  return crypto.subtle.unwrapKey(
    "raw",
    wrapped,
    myPrivateKey,
    { name: "RSA-OAEP" },
    AES_GCM_PARAMS,
    extractable,
    ["encrypt", "decrypt"],
  );
}

export interface EncryptedMessage {
  iv: Uint8Array;
  ciphertext: Uint8Array;
}

/**
 * Encrypts a plaintext message under a session key with a fresh random IV.
 * A fresh IV per encryption is a hard AES-GCM requirement: reusing an IV
 * under the same key breaks both confidentiality and the authentication
 * guarantee. crypto.getRandomValues is a CSPRNG, so collisions across a
 * conversation's message count are negligible for the 12-byte (96-bit) IV
 * size AES-GCM is designed around.
 */
export async function encryptMessage(
  sessionKey: CryptoKey,
  plaintext: Uint8Array,
): Promise<EncryptedMessage> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, sessionKey, plaintext);
  return { iv, ciphertext: new Uint8Array(ciphertext) };
}

export class DecryptError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "DecryptError";
  }
}

/**
 * Decrypts a message. Deliberately does not distinguish "wrong key" from
 * "corrupted/tampered ciphertext" in the thrown error — both surface
 * identically as DecryptError to the caller, so the UI can't be used as an
 * oracle to probe which failure mode occurred.
 */
export async function decryptMessage(
  sessionKey: CryptoKey,
  iv: Uint8Array,
  ciphertext: Uint8Array,
): Promise<Uint8Array> {
  try {
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, sessionKey, ciphertext);
    return new Uint8Array(plaintext);
  } catch (err) {
    throw new DecryptError("could not decrypt message", { cause: err });
  }
}
