/**
 * Byte/base64url helpers used across the crypto-core modules. Implemented
 * without atob/btoa since those operate on Latin1 "binary strings" and are
 * an easy source of mangled-byte bugs when handling arbitrary binary data
 * (and are not guaranteed present in every runtime crypto-core targets:
 * Node under Vitest, the MV3 service worker, and content scripts).
 */

const B64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const B64URL_DECODE_MAP: Record<string, number> = Object.fromEntries(
  [...B64URL_ALPHABET].map((c, i) => [c, i]),
);

export function base64UrlEncode(bytes: Uint8Array): string {
  let output = "";
  let i = 0;
  for (; i + 3 <= bytes.length; i += 3) {
    const [b0, b1, b2] = [bytes[i]!, bytes[i + 1]!, bytes[i + 2]!];
    output += B64URL_ALPHABET[b0 >> 2];
    output += B64URL_ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)];
    output += B64URL_ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)];
    output += B64URL_ALPHABET[b2 & 0x3f];
  }
  const remaining = bytes.length - i;
  if (remaining === 1) {
    const b0 = bytes[i]!;
    output += B64URL_ALPHABET[b0 >> 2];
    output += B64URL_ALPHABET[(b0 & 0x03) << 4];
  } else if (remaining === 2) {
    const [b0, b1] = [bytes[i]!, bytes[i + 1]!];
    output += B64URL_ALPHABET[b0 >> 2];
    output += B64URL_ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)];
    output += B64URL_ALPHABET[(b1 & 0x0f) << 2];
  }
  return output;
}

export class Base64UrlDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Base64UrlDecodeError";
  }
}

export function base64UrlDecode(input: string): Uint8Array {
  const chars = [...input];
  if (chars.some((c) => !(c in B64URL_DECODE_MAP))) {
    throw new Base64UrlDecodeError("input contains characters outside the base64url alphabet");
  }
  const byteLength = Math.floor((chars.length * 6) / 8);
  const out = new Uint8Array(byteLength);
  let buffer = 0;
  let bitsInBuffer = 0;
  let outIndex = 0;
  for (const c of chars) {
    buffer = (buffer << 6) | B64URL_DECODE_MAP[c]!;
    bitsInBuffer += 6;
    if (bitsInBuffer >= 8) {
      bitsInBuffer -= 8;
      out[outIndex++] = (buffer >> bitsInBuffer) & 0xff;
    }
  }
  return out;
}

export function utf8Encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function utf8Decode(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export function concatBytes(...chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i]! ^ b[i]!;
  }
  return diff === 0;
}
