import { describe, expect, it } from "vitest";
import { utf8Decode, utf8Encode } from "../src/bytes.js";
import {
	type EncodableEnvelope,
	type EnvelopeFields,
	MsgType,
} from "../src/envelope.js";
import { shortKeyId } from "../src/fingerprint.js";
import {
	createSessionKeyAck,
	detectKeyChange,
	HandshakeError,
	HandshakeInitiator,
	HandshakeResponder,
} from "../src/handshake.js";
import { exportPublicKeyJwk, generateIdentityKeyPair } from "../src/keys.js";
import { decryptMessage, encryptMessage } from "../src/session.js";

/** Stands in for what a real transport would attach: the fixed WIRE_VERSION byte
 *  is the only field EncodableEnvelope omits relative to EnvelopeFields. */
function toFields(encodable: EncodableEnvelope): EnvelopeFields {
	return { version: 1, ...encodable };
}

describe("HandshakeInitiator / HandshakeResponder", () => {
	it("completes a full handshake and derives a shared, working session key", async () => {
		const alice = await generateIdentityKeyPair();
		const bob = await generateIdentityKeyPair();

		const initiator = new HandshakeInitiator(alice);
		const responder = new HandshakeResponder(bob);

		const initEnvelope = toFields(await initiator.createInit());
		const { responseFields, sessionKey: bobSessionKey } =
			await responder.handleInit(initEnvelope);

		const { sessionKey: aliceSessionKey } = await initiator.handleResponse(
			toFields(responseFields),
		);

		const { iv, ciphertext } = await encryptMessage(
			aliceSessionKey,
			utf8Encode("hi bob"),
		);
		const decrypted = await decryptMessage(bobSessionKey, iv, ciphertext);
		expect(utf8Decode(decrypted)).toBe("hi bob");
	});

	it("rejects starting a second init on the same initiator instance", async () => {
		const alice = await generateIdentityKeyPair();
		const initiator = new HandshakeInitiator(alice);
		await initiator.createInit();
		await expect(initiator.createInit()).rejects.toThrow(HandshakeError);
	});

	it("rejects a response with a mismatched nonce", async () => {
		const alice = await generateIdentityKeyPair();
		const bob = await generateIdentityKeyPair();
		const otherAttempt = await generateIdentityKeyPair();

		const initiator = new HandshakeInitiator(alice);
		await initiator.createInit();

		// A response generated for a *different* init (different nonce) must be rejected.
		const rogueInitiator = new HandshakeInitiator(otherAttempt);
		const rogueInit = toFields(await rogueInitiator.createInit());
		const responder = new HandshakeResponder(bob);
		const { responseFields } = await responder.handleInit(rogueInit);

		await expect(
			initiator.handleResponse(toFields(responseFields)),
		).rejects.toThrow(HandshakeError);
	});

	it("rejects handling a response when no handshake is in progress", async () => {
		const alice = await generateIdentityKeyPair();
		const bob = await generateIdentityKeyPair();
		const initiator = new HandshakeInitiator(alice); // never calls createInit()

		const helperInitiator = new HandshakeInitiator(alice);
		const init = toFields(await helperInitiator.createInit());
		const responder = new HandshakeResponder(bob);
		const { responseFields } = await responder.handleInit(init);

		await expect(
			initiator.handleResponse(toFields(responseFields)),
		).rejects.toThrow(HandshakeError);
	});

	it("rejects replaying an already-consumed response", async () => {
		const alice = await generateIdentityKeyPair();
		const bob = await generateIdentityKeyPair();
		const initiator = new HandshakeInitiator(alice);
		const responder = new HandshakeResponder(bob);

		const init = toFields(await initiator.createInit());
		const { responseFields } = await responder.handleInit(init);
		const fields = toFields(responseFields);

		await initiator.handleResponse(fields);
		await expect(initiator.handleResponse(fields)).rejects.toThrow(
			HandshakeError,
		);
	});

	it("rejects an init envelope with the wrong msgType", async () => {
		const bob = await generateIdentityKeyPair();
		const responder = new HandshakeResponder(bob);
		const badFields: EnvelopeFields = {
			version: 1,
			senderKeyId: new Uint8Array(8),
			sessionKeyId: new Uint8Array(8),
			msgType: MsgType.DATA,
			iv: new Uint8Array(12),
			payload: new Uint8Array(0),
		};
		await expect(responder.handleInit(badFields)).rejects.toThrow(
			HandshakeError,
		);
	});
});

describe("createSessionKeyAck", () => {
	it("builds an ACK envelope with the correct senderKeyId and empty payload", async () => {
		const { publicKey } = await generateIdentityKeyPair();
		const jwk = await exportPublicKeyJwk(publicKey);
		const expectedSenderKeyId = await shortKeyId(jwk);
		const sessionKeyId = crypto.getRandomValues(new Uint8Array(8));

		const ack = await createSessionKeyAck(jwk, sessionKeyId);
		expect(ack.senderKeyId).toEqual(expectedSenderKeyId);
		expect(ack.sessionKeyId).toEqual(sessionKeyId);
		expect(ack.msgType).toBe(MsgType.SESSION_KEY_ACK);
		expect(ack.payload.length).toBe(0);
	});
});

describe("detectKeyChange", () => {
	it("returns false when there is no existing key on file", () => {
		expect(detectKeyChange(null, new Uint8Array(8))).toBe(false);
	});

	it("returns false when the incoming key id matches the one on file", () => {
		const id = crypto.getRandomValues(new Uint8Array(8));
		expect(detectKeyChange(id, id)).toBe(false);
	});

	it("returns true when the incoming key id differs from the one on file", () => {
		const existing = new Uint8Array(8).fill(1);
		const incoming = new Uint8Array(8).fill(2);
		expect(detectKeyChange(existing, incoming)).toBe(true);
	});
});
