import { utf8Encode } from "./bytes.js";

/**
 * Canonicalizes a public key JWK to a deterministic byte string before
 * hashing, so the same key always produces the same fingerprint regardless
 * of JWK field ordering.
 */
function canonicalizeJwk(jwk: JsonWebKey): Uint8Array {
  const sortedKeys = Object.keys(jwk).sort();
  const sorted: Record<string, unknown> = {};
  for (const key of sortedKeys) {
    sorted[key] = (jwk as Record<string, unknown>)[key];
  }
  return utf8Encode(JSON.stringify(sorted));
}

/** Full SHA-256 fingerprint of a public key, as raw bytes. */
export async function fingerprintPublicKey(jwk: JsonWebKey): Promise<Uint8Array> {
  const canonical = canonicalizeJwk(jwk);
  const digest = await crypto.subtle.digest("SHA-256", canonical);
  return new Uint8Array(digest);
}

/**
 * The short key id embedded in every envelope (see docs/WIRE_FORMAT.md):
 * the first 8 bytes of the full fingerprint. Short enough to keep envelopes
 * compact; collision risk across a user's small contact list is negligible
 * and a full fingerprint is always available for verification in the UI.
 */
export async function shortKeyId(jwk: JsonWebKey): Promise<Uint8Array> {
  const full = await fingerprintPublicKey(jwk);
  return full.slice(0, 8);
}

/**
 * Renders a fingerprint as grouped decimal digits (Signal-style), e.g.
 * "12345 67890 12345 ...". Uses the full 32-byte digest.
 */
export function formatFingerprint(fingerprint: Uint8Array, groupSize = 5): string {
  // Fold the 32 bytes into a run of decimal digits by treating consecutive
  // pairs of bytes as a big-endian 16-bit number (0-65535) rendered as up
  // to 5 digits, zero-padded — a simple, dependency-free scheme that still
  // gives users a stable, comparable string.
  const groups: string[] = [];
  for (let i = 0; i + 1 < fingerprint.length; i += 2) {
    const value = (fingerprint[i]! << 8) | fingerprint[i + 1]!;
    groups.push(value.toString().padStart(5, "0"));
  }
  const digits = groups.join("");
  const chunks: string[] = [];
  for (let i = 0; i < digits.length; i += groupSize) {
    chunks.push(digits.slice(i, i + groupSize));
  }
  return chunks.join(" ");
}

/**
 * A combined "safety number" for a pair of contacts, deterministic
 * regardless of which side computes it (fingerprints are sorted before
 * concatenation) so both users see the same string to compare out-of-band.
 */
export function combinedSafetyNumber(fingerprintA: Uint8Array, fingerprintB: Uint8Array): string {
  const [first, second] = compareBytes(fingerprintA, fingerprintB) <= 0
    ? [fingerprintA, fingerprintB]
    : [fingerprintB, fingerprintA];
  return `${formatFingerprint(first)} :: ${formatFingerprint(second)}`;
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return a[i]! - b[i]!;
  }
  return a.length - b.length;
}
