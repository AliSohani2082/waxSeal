import {
	base64UrlDecode,
	base64UrlEncode,
	combinedSafetyNumber,
	createSessionKeyAck,
	DecryptError,
	decodeEnvelope,
	decryptMessage,
	EnvelopeDecodeError,
	type EnvelopeFields,
	encodeEnvelope,
	encryptMessage,
	exportPublicKeyJwk,
	fingerprintPublicKey,
	generateIdentityKeyPair,
	HandshakeInitiator,
	HandshakeResponder,
	MsgType,
	shortKeyId,
	unwrapSessionKey,
	utf8Decode,
	utf8Encode,
} from "@waxseal/crypto-core";
import { PeerStore, toHex } from "./peer-store.js";
import type {
	BackgroundRequest,
	BackgroundResponse,
	ContentScriptMessage,
} from "./protocol.js";
import { NonExtractableKeyStore } from "./storage.js";

const keyStore = new NonExtractableKeyStore();
const peerStore = new PeerStore();

let myKeyPair: CryptoKeyPair | null = null;
let myPublicKeyJwk: JsonWebKey | null = null;
let _mySenderKeyIdHex: string | null = null;
let mySenderKeyIdBytes: Uint8Array | null = null;
let myFingerprint: Uint8Array | null = null;

// Per-tab active peer: tabId → senderKeyIdHex of the current session peer
const tabPeer = new Map<number, string>();

// Memoized so concurrent messages (a service worker processes them on one
// event loop but with interleaved awaits) cannot each generate and persist a
// separate identity — that race produced a transient "ghost" key that the
// handshake responder would advertise instead of the persisted identity.
let identityPromise: Promise<void> | null = null;

function ensureIdentity(): Promise<void> {
	if (!identityPromise) identityPromise = initIdentity();
	return identityPromise;
}

async function initIdentity(): Promise<void> {
	let loaded = await keyStore.loadIdentityKey();
	if (!loaded) {
		const raw = await generateIdentityKeyPair(true);
		await keyStore.saveIdentityKey(raw);
		loaded = await keyStore.loadIdentityKey();
	}
	myKeyPair = loaded!;
	myPublicKeyJwk = await exportPublicKeyJwk(myKeyPair.publicKey);
	mySenderKeyIdBytes = await shortKeyId(myPublicKeyJwk);
	_mySenderKeyIdHex = toHex(mySenderKeyIdBytes);
	myFingerprint = await fingerprintPublicKey(myPublicKeyJwk);
}

function injectEnvelopeIntoTab(tabId: number, envelopeB64: string): void {
	const msg: ContentScriptMessage = { type: "INJECT_ENVELOPE", envelopeB64 };
	chrome.tabs.sendMessage(tabId, msg);
}

export async function handleMessage(
	req: BackgroundRequest,
	tabId: number,
): Promise<BackgroundResponse> {
	await ensureIdentity();

	if (req.type === "GET_CONTEXT") {
		const peerKeyIdHex = tabPeer.get(tabId) ?? null;
		if (!peerKeyIdHex) {
			return { ok: true, type: "CONTEXT", peerKeyIdHex: null, state: "IDLE" };
		}
		const rec = await peerStore.get(peerKeyIdHex);
		const state = rec?.handshakeState ?? "IDLE";
		return { ok: true, type: "CONTEXT", peerKeyIdHex, state };
	}

	if (req.type === "GET_STATUS") {
		const peerKeyIdHex = tabPeer.get(tabId);
		if (!peerKeyIdHex) return { ok: true, type: "STATUS", state: "IDLE" };
		const rec = await peerStore.get(peerKeyIdHex);
		return { ok: true, type: "STATUS", state: rec?.handshakeState ?? "IDLE" };
	}

	if (req.type === "GET_SAFETY_NUMBER") {
		if (!myFingerprint) return { ok: false, error: "NO_PEER" };
		const peerKeyIdHex = tabPeer.get(tabId);
		if (!peerKeyIdHex) return { ok: false, error: "NO_PEER" };
		const rec = await peerStore.get(peerKeyIdHex);
		if (rec?.handshakeState !== "ACTIVE")
			return { ok: false, error: "NO_SESSION" };
		const peerFp = await fingerprintPublicKey(rec.peerPublicKeyJwk);
		const number = combinedSafetyNumber(myFingerprint, peerFp);
		return { ok: true, type: "SAFETY_NUMBER", number };
	}

	if (req.type === "INITIATE_HANDSHAKE") {
		const initiator = new HandshakeInitiator(myKeyPair!);
		const initFields = await initiator.createInit();

		// Extract the nonce from the init payload JSON
		const payloadText = new TextDecoder().decode(initFields.payload);
		const payloadObj = JSON.parse(payloadText) as {
			nonce: string;
			publicKeyJwk: JsonWebKey;
		};
		const pendingNonceB64 = payloadObj.nonce; // already base64url encoded

		const envelopeB64 = encodeEnvelope(initFields);

		// Store pending state keyed by tab, so we can correlate the response
		const pendingKey = `pending:${tabId}`;
		await peerStore.save({
			senderKeyIdHex: pendingKey,
			peerPublicKeyJwk: {} as JsonWebKey,
			sessionKey: null,
			sessionKeyIdB64: null,
			handshakeState: "PENDING",
			pendingNonceB64,
		});
		tabPeer.set(tabId, pendingKey);

		injectEnvelopeIntoTab(tabId, envelopeB64);
		return { ok: true, type: "HANDSHAKE_INJECTED" };
	}

	if (req.type === "ENCRYPT") {
		const rec = await peerStore.get(req.peerKeyIdHex);
		if (
			rec?.handshakeState !== "ACTIVE" ||
			!rec.sessionKey ||
			!rec.sessionKeyIdB64
		) {
			return { ok: false, error: "NO_SESSION" };
		}
		const { iv, ciphertext } = await encryptMessage(
			rec.sessionKey,
			utf8Encode(req.plaintext),
		);
		const sessionKeyIdBytes = base64UrlDecode(rec.sessionKeyIdB64);
		const envelopeB64 = encodeEnvelope({
			senderKeyId: mySenderKeyIdBytes!,
			sessionKeyId: sessionKeyIdBytes,
			msgType: MsgType.DATA,
			iv,
			payload: ciphertext,
		});
		return { ok: true, type: "ENCRYPTED", envelopeB64 };
	}

	if (req.type === "DECRYPT") {
		let fields: EnvelopeFields;
		try {
			fields = decodeEnvelope(req.envelopeB64);
		} catch (err) {
			if (err instanceof EnvelopeDecodeError)
				return { ok: false, error: "DECRYPT_FAILED" };
			throw err;
		}

		const incomingSenderKeyIdHex = toHex(fields.senderKeyId);

		if (fields.msgType === MsgType.HANDSHAKE_INIT) {
			// Check for key change: if tab has an ACTIVE session with a different peer
			const existingPeerKeyId = tabPeer.get(tabId);
			if (existingPeerKeyId && !existingPeerKeyId.startsWith("pending:")) {
				const existingRec = await peerStore.get(existingPeerKeyId);
				if (
					existingRec?.handshakeState === "ACTIVE" &&
					existingPeerKeyId !== incomingSenderKeyIdHex
				) {
					return { ok: false, error: "KEY_CHANGE_DETECTED" };
				}
			}

			const responder = new HandshakeResponder(myKeyPair!);
			const {
				responseFields,
				peerPublicKeyJwk,
				sessionKey,
				sessionKeyId,
				senderKeyId,
			} = await responder.handleInit(fields);

			const peerKeyIdHex = toHex(senderKeyId);
			const sessionKeyIdB64 = base64UrlEncode(sessionKeyId);

			await peerStore.save({
				senderKeyIdHex: peerKeyIdHex,
				peerPublicKeyJwk,
				sessionKey,
				sessionKeyIdB64,
				handshakeState: "ACTIVE",
				pendingNonceB64: null,
			});
			tabPeer.set(tabId, peerKeyIdHex);

			injectEnvelopeIntoTab(tabId, encodeEnvelope(responseFields));
			return { ok: true, type: "HANDSHAKE_INJECTED" };
		}

		if (fields.msgType === MsgType.HANDSHAKE_RESPONSE) {
			const pendingKey = `pending:${tabId}`;
			const pendingRec = await peerStore.get(pendingKey);
			if (!pendingRec?.pendingNonceB64) {
				return { ok: false, error: "DECRYPT_FAILED" };
			}

			// Verify echoed nonce and parse response payload
			const payloadText = new TextDecoder().decode(fields.payload);
			const payload = JSON.parse(payloadText) as {
				echoedNonce: string;
				wrappedSessionKey: string;
				publicKeyJwk: JsonWebKey;
			};
			if (payload.echoedNonce !== pendingRec.pendingNonceB64) {
				return { ok: false, error: "DECRYPT_FAILED" };
			}

			// Unwrap the session key using our private key
			const wrappedBytes = base64UrlDecode(payload.wrappedSessionKey);
			const sessionKey = await unwrapSessionKey(
				wrappedBytes,
				myKeyPair?.privateKey,
			);

			const peerKeyIdHex = toHex(fields.senderKeyId);
			const sessionKeyIdB64 = base64UrlEncode(fields.sessionKeyId);

			await peerStore.save({
				senderKeyIdHex: peerKeyIdHex,
				peerPublicKeyJwk: payload.publicKeyJwk,
				sessionKey,
				sessionKeyIdB64,
				handshakeState: "ACTIVE",
				pendingNonceB64: null,
			});
			tabPeer.set(tabId, peerKeyIdHex);

			// Send SESSION_KEY_ACK to complete the handshake
			const ackFields = await createSessionKeyAck(
				myPublicKeyJwk!,
				fields.sessionKeyId,
			);
			injectEnvelopeIntoTab(tabId, encodeEnvelope(ackFields));
			return { ok: true, type: "HANDSHAKE_INJECTED" };
		}

		if (fields.msgType === MsgType.SESSION_KEY_ACK) {
			// Peer confirmed receipt — session is already ACTIVE on our side
			return { ok: true, type: "STATUS", state: "ACTIVE" };
		}

		if (fields.msgType === MsgType.DATA) {
			const rec = await peerStore.get(incomingSenderKeyIdHex);
			if (!rec?.sessionKey) return { ok: false, error: "NO_SESSION" };
			try {
				const plaintextBytes = await decryptMessage(
					rec.sessionKey,
					fields.iv,
					fields.payload,
				);
				const plaintext = utf8Decode(plaintextBytes);
				return {
					ok: true,
					type: "DECRYPTED",
					plaintext,
					peerKeyIdHex: incomingSenderKeyIdHex,
				};
			} catch (err) {
				if (err instanceof DecryptError)
					return { ok: false, error: "DECRYPT_FAILED" };
				throw err;
			}
		}

		return { ok: false, error: "DECRYPT_FAILED" };
	}

	return { ok: false, error: "DECRYPT_FAILED" };
}

// Register the message listener when this module is loaded in the extension.
// Guard against non-browser environments (e.g., Node.js test runners) where
// chrome is not defined at module initialisation time.
if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
	chrome.runtime.onMessage.addListener(
		(
			message: unknown,
			sender: chrome.runtime.MessageSender,
			sendResponse: (r: BackgroundResponse) => void,
		) => {
			const tabId = sender.tab?.id ?? -1;
			handleMessage(message as BackgroundRequest, tabId)
				.then(sendResponse)
				.catch(() => sendResponse({ ok: false, error: "DECRYPT_FAILED" }));
			return true; // keep message channel open for async response
		},
	);
}

// Test-only hook: expose handleMessage in the service-worker global scope so
// Playwright E2E tests can drive the background directly. A page's main world
// cannot message a content-script extension via chrome.runtime.sendMessage
// (Chrome requires an extension id and routes to onMessageExternal), so the
// tests reach the background through the service-worker context instead. This
// does not widen the extension's attack surface — the SW global is reachable
// only via the DevTools/automation protocol, never from web content.
(
	globalThis as unknown as { __waxsealHandleMessage?: typeof handleMessage }
).__waxsealHandleMessage = handleMessage;
