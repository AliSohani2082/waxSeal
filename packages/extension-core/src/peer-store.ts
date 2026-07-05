import type { HandshakeState } from "./protocol.js";
import { idbGet, idbPut } from "./storage.js";

export interface PeerRecord {
	senderKeyIdHex: string;
	peerPublicKeyJwk: JsonWebKey;
	sessionKey: CryptoKey | null;
	sessionKeyIdB64: string | null;
	handshakeState: HandshakeState;
	pendingNonceB64: string | null;
}

const DB_NAME = "waxseal";
const DB_VERSION = 1;
const STORE_NAME = "peers";

function openDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, DB_VERSION);
		req.onupgradeneeded = (ev) => {
			const db = (ev.target as IDBOpenDBRequest).result;
			if (!db.objectStoreNames.contains("identity-keys")) {
				db.createObjectStore("identity-keys");
			}
			if (!db.objectStoreNames.contains(STORE_NAME)) {
				db.createObjectStore(STORE_NAME, { keyPath: "senderKeyIdHex" });
			}
		};
		req.onsuccess = (ev) => resolve((ev.target as IDBOpenDBRequest).result);
		req.onerror = () => reject(req.error);
	});
}

export class PeerStore {
	private dbPromise: Promise<IDBDatabase> = openDb();

	async get(senderKeyIdHex: string): Promise<PeerRecord | null> {
		const db = await this.dbPromise;
		return idbGet<PeerRecord>(db, STORE_NAME, senderKeyIdHex);
	}

	async save(record: PeerRecord): Promise<void> {
		const db = await this.dbPromise;
		await idbPut(db, STORE_NAME, record);
	}
}

export function toHex(bytes: Uint8Array): string {
	return Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}
