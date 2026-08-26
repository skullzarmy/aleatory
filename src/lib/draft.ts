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

function open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB, VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE)) {
                db.createObjectStore(STORE, { keyPath: "id" });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await open();
    return new Promise<T>((resolve, reject) => {
        const request = fn(db.transaction(STORE, mode).objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

export async function listDrafts(): Promise<Draft[]> {
    const all = await tx<Draft[]>("readonly", (s) => s.getAll() as IDBRequest<Draft[]>);
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getDraft(id: string): Promise<Draft | null> {
    const found = await tx<Draft | undefined>("readonly", (s) => s.get(id) as IDBRequest<Draft | undefined>);
    return found ?? null;
}

export async function saveDraft(draft: Draft): Promise<void> {
    await tx("readwrite", (s) => s.put({ ...draft, updatedAt: Date.now() }));
}

export async function deleteDraft(id: string): Promise<void> {
    await tx("readwrite", (s) => s.delete(id));
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
