/**
 * Work in progress, held in the browser.
 *
 * A generator exists before a collection does, and there is no server to keep
 * it on. Drafts live in IndexedDB: no account, nothing of the artist's on our
 * infrastructure, and a cleared browser loses unpublished work, which the
 * studio says out loud.
 *
 * A draft is exportable as the `.zip` it came from at any point, which is the
 * real answer to durability: the artist's own disk.
 */
import type { ParamSpec } from "./params";
import type { PackagedProject } from "./project";

const DB = "aleatory-studio";
const STORE = "drafts";
const VERSION = 1;

export interface Draft {
    id: string;
    name: string;
    /** Runtime kind, from runtimes.ts. */
    kindId: number;
    /** The generator, with its local files already inlined. */
    html: string;
    /** Declared parameters, up to five, per params.md. */
    params: ParamSpec[];
    /** The seed the artist pinned as the one they look at. */
    seed: string;
    createdAt: number;
    updatedAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function getFallbackStore(): Record<string, Draft> {
    if (typeof window === "undefined" || typeof localStorage === "undefined") return {};
    try {
        const raw = localStorage.getItem("aleatory:drafts");
        return raw ? (JSON.parse(raw) as Record<string, Draft>) : {};
    } catch {
        return {};
    }
}

function setFallbackStore(store: Record<string, Draft>): void {
    if (typeof window === "undefined" || typeof localStorage === "undefined") return;
    try {
        localStorage.setItem("aleatory:drafts", JSON.stringify(store));
    } catch {
        // ignore quota errors
    }
}

function open(): Promise<IDBDatabase> {
    if (typeof window === "undefined" || typeof indexedDB === "undefined") {
        return Promise.reject(new Error("IndexedDB is not available"));
    }
    if (dbPromise) return dbPromise;

    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(DB, VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE)) {
                db.createObjectStore(STORE, { keyPath: "id" });
            }
        };
        req.onsuccess = () => {
            const db = req.result;
            db.onversionchange = () => {
                db.close();
                dbPromise = null;
            };
            resolve(db);
        };
        req.onerror = () => {
            dbPromise = null;
            reject(req.error ?? new Error("Failed to open IndexedDB"));
        };
        req.onblocked = () => {
            dbPromise = null;
            reject(new Error("IndexedDB open blocked"));
        };
    });

    return dbPromise;
}

async function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await open();
    return new Promise<T>((resolve, reject) => {
        try {
            const transaction = db.transaction(STORE, mode);
            const store = transaction.objectStore(STORE);
            const request = fn(store);

            let result: T;
            request.onsuccess = () => {
                result = request.result;
                if (mode === "readonly") {
                    resolve(result);
                }
            };
            request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
            transaction.oncomplete = () => {
                if (mode === "readwrite") {
                    resolve(result);
                }
            };
            transaction.onerror = () => {
                dbPromise = null;
                reject(transaction.error ?? new Error("IndexedDB transaction failed"));
            };
            transaction.onabort = () => {
                dbPromise = null;
                reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
            };
        } catch (err) {
            dbPromise = null;
            reject(err);
        }
    });
}

export async function listDrafts(): Promise<Draft[]> {
    const fallback = Object.values(getFallbackStore());
    try {
        const idbList = tx<Draft[]>("readonly", (s) => s.getAll() as IDBRequest<Draft[]>);
        const timeout = new Promise<Draft[]>((resolve) => setTimeout(() => resolve([]), 300));
        const all = await Promise.race([idbList, timeout]);
        const ids = new Set(all.map((d) => d.id));
        for (const f of fallback) {
            if (!ids.has(f.id)) all.push(f);
        }
        return all.sort((a, b) => b.updatedAt - a.updatedAt);
    } catch {
        return fallback.sort((a, b) => b.updatedAt - a.updatedAt);
    }
}

export async function getDraft(id: string): Promise<Draft | null> {
    const fromFallback = getFallbackStore()[id];
    try {
        const idbGet = tx<Draft | undefined>("readonly", (s) => s.get(id) as IDBRequest<Draft | undefined>);
        const timeout = new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 300));
        const fromIdb = await Promise.race([idbGet, timeout]);
        if (fromIdb) return fromIdb;
    } catch {
        // Fall back
    }
    return fromFallback ?? null;
}

export async function saveDraft(draft: Draft): Promise<void> {
    const item = { ...draft, updatedAt: Date.now() };
    const fb = getFallbackStore();
    fb[draft.id] = item;
    setFallbackStore(fb);

    try {
        const idbSave = tx("readwrite", (s) => s.put(item));
        const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("IDB timeout")), 300));
        await Promise.race([idbSave, timeout]);
    } catch {
        // Fallback store was already written synchronously
    }
}

export async function deleteDraft(id: string): Promise<void> {
    const fb = getFallbackStore();
    delete fb[id];
    setFallbackStore(fb);

    try {
        const idbDelete = tx("readwrite", (s) => s.delete(id));
        const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("IDB timeout")), 300));
        await Promise.race([idbDelete, timeout]);
    } catch {
        // Fallback store was already updated
    }
}

export function newDraft(
    name: string,
    kindId: number,
    project: PackagedProject,
    params: ParamSpec[] = [],
): Draft {
    return {
        id: crypto.randomUUID(),
        name,
        kindId,
        html: project.html,
        params,
        seed: randomSeed(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
    };
}

/**
 * A seed to look at while working.
 *
 * Shaped like an operation hash so what an artist sees in the studio is the
 * same kind of value a real mint produces.
 */
export function randomSeed(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return (
        "oo" +
        Array.from(bytes)
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("")
            .slice(0, 49)
    );
}

/** Seeds for the grid: derived from one base so a grid is reproducible. */
export function seedAt(base: string, index: number): string {
    return `${base}:${index}`;
}
