import { exportPrivateKeyJwk, importPrivateKeyJwk } from "@waxseal/crypto-core";

export interface KeyStore {
	loadIdentityKey(): Promise<CryptoKeyPair | null>;
	saveIdentityKey(pair: CryptoKeyPair): Promise<void>;
}

const DB_NAME = "waxseal";
const DB_VERSION = 1;
const STORE_NAME = "identity-keys";
const RECORD_KEY = "identity";

function openDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, DB_VERSION);
		req.onupgradeneeded = (ev) => {
			const db = (ev.target as IDBOpenDBRequest).result;
			if (!db.objectStoreNames.contains(STORE_NAME)) {
				db.createObjectStore(STORE_NAME);
			}
			if (!db.objectStoreNames.contains("peers")) {
				db.createObjectStore("peers", { keyPath: "senderKeyIdHex" });
			}
		};
		req.onsuccess = (ev) => resolve((ev.target as IDBOpenDBRequest).result);
		req.onerror = () => reject(req.error);
	});
}

export function idbGet<T>(
	db: IDBDatabase,
	storeName: string,
	key: string,
): Promise<T | null> {
	return new Promise((resolve, reject) => {
		const tx = db.transaction(storeName, "readonly");
		const req = tx.objectStore(storeName).get(key);
		req.onsuccess = () => resolve((req.result as T | undefined) ?? null);
		req.onerror = () => reject(req.error);
	});
}

export function idbPut(
	db: IDBDatabase,
	storeName: string,
	value: unknown,
	key?: string,
): Promise<void> {
	return new Promise((resolve, reject) => {
		const tx = db.transaction(storeName, "readwrite");
		const req =
			key !== undefined
				? tx.objectStore(storeName).put(value, key)
				: tx.objectStore(storeName).put(value);
		req.onsuccess = () => resolve();
		req.onerror = () => reject(req.error);
	});
}

export function idbDelete(
	db: IDBDatabase,
	storeName: string,
	key: string,
): Promise<void> {
	return new Promise((resolve, reject) => {
		const tx = db.transaction(storeName, "readwrite");
		const req = tx.objectStore(storeName).delete(key);
		req.onsuccess = () => resolve();
		req.onerror = () => reject(req.error);
	});
}

export function idbGetAll<T>(db: IDBDatabase, storeName: string): Promise<T[]> {
	return new Promise((resolve, reject) => {
		const tx = db.transaction(storeName, "readonly");
		const req = tx.objectStore(storeName).getAll();
		req.onsuccess = () => resolve(req.result as T[]);
		req.onerror = () => reject(req.error);
	});
}

interface StoredIdentity {
	publicKey: CryptoKey;
	privateKeyJwk: JsonWebKey;
}

export class NonExtractableKeyStore implements KeyStore {
	private dbPromise: Promise<IDBDatabase> = openDb();

	async loadIdentityKey(): Promise<CryptoKeyPair | null> {
		const db = await this.dbPromise;
		const stored = await idbGet<StoredIdentity>(db, STORE_NAME, RECORD_KEY);
		if (!stored) return null;
		const privateKey = await importPrivateKeyJwk(stored.privateKeyJwk, false);
		return { publicKey: stored.publicKey, privateKey };
	}

	async saveIdentityKey(pair: CryptoKeyPair): Promise<void> {
		const db = await this.dbPromise;
		const privateKeyJwk = await exportPrivateKeyJwk(pair.privateKey);
		const stored: StoredIdentity = { publicKey: pair.publicKey, privateKeyJwk };
		await idbPut(db, STORE_NAME, stored, RECORD_KEY);
	}
}
