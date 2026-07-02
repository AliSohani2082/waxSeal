import { describe, expect, it } from "vitest";
import { generateIdentityKeyPair } from "../src/keys.js";
import {
  generateSessionKey,
  wrapSessionKey,
  unwrapSessionKey,
  encryptMessage,
  decryptMessage,
  DecryptError,
} from "../src/session.js";
import { utf8Encode, utf8Decode } from "../src/bytes.js";

describe("generateSessionKey", () => {
  it("generates an extractable AES-256-GCM key", async () => {
    const key = await generateSessionKey();
    expect(key.algorithm.name).toBe("AES-GCM");
    expect((key.algorithm as AesKeyAlgorithm).length).toBe(256);
    expect(key.extractable).toBe(true);
  });
});

describe("wrapSessionKey / unwrapSessionKey", () => {
  it("round-trips a session key through RSA-OAEP wrapping", async () => {
    const { publicKey, privateKey } = await generateIdentityKeyPair();
    const sessionKey = await generateSessionKey();
    const wrapped = await wrapSessionKey(sessionKey, publicKey);
    const unwrapped = await unwrapSessionKey(wrapped, privateKey);

    const { iv, ciphertext } = await encryptMessage(sessionKey, utf8Encode("secret message"));
    const decrypted = await decryptMessage(unwrapped, iv, ciphertext);
    expect(utf8Decode(decrypted)).toBe("secret message");
  });

  it("unwraps as non-extractable by default", async () => {
    const { publicKey, privateKey } = await generateIdentityKeyPair();
    const sessionKey = await generateSessionKey();
    const wrapped = await wrapSessionKey(sessionKey, publicKey);
    const unwrapped = await unwrapSessionKey(wrapped, privateKey);
    expect(unwrapped.extractable).toBe(false);
  });
});

describe("encryptMessage / decryptMessage", () => {
  it("round-trips plaintext of varying sizes, including empty", async () => {
    const key = await generateSessionKey();
    for (const text of ["", "a", "hello world", "x".repeat(5000)]) {
      const { iv, ciphertext } = await encryptMessage(key, utf8Encode(text));
      const decrypted = await decryptMessage(key, iv, ciphertext);
      expect(utf8Decode(decrypted)).toBe(text);
    }
  });

  it("uses a fresh IV on every call", async () => {
    const key = await generateSessionKey();
    const a = await encryptMessage(key, utf8Encode("same plaintext"));
    const b = await encryptMessage(key, utf8Encode("same plaintext"));
    expect(a.iv).not.toEqual(b.iv);
  });

  it("throws DecryptError when decrypting with the wrong key", async () => {
    const keyA = await generateSessionKey();
    const keyB = await generateSessionKey();
    const { iv, ciphertext } = await encryptMessage(keyA, utf8Encode("secret"));
    await expect(decryptMessage(keyB, iv, ciphertext)).rejects.toThrow(DecryptError);
  });

  it("throws DecryptError when the ciphertext is tampered with", async () => {
    const key = await generateSessionKey();
    const { iv, ciphertext } = await encryptMessage(key, utf8Encode("secret"));
    const tampered = new Uint8Array(ciphertext);
    tampered[0] = tampered[0]! ^ 0xff;
    await expect(decryptMessage(key, iv, tampered)).rejects.toThrow(DecryptError);
  });

  it("throws DecryptError when the IV is wrong", async () => {
    const key = await generateSessionKey();
    const { ciphertext } = await encryptMessage(key, utf8Encode("secret"));
    const wrongIv = crypto.getRandomValues(new Uint8Array(12));
    await expect(decryptMessage(key, wrongIv, ciphertext)).rejects.toThrow(DecryptError);
  });
});
