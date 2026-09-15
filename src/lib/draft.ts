/**
 * Work in progress, held in the browser. Drafts live in IndexedDB, so there is
 * no account and nothing of the artist's on our infrastructure. A cleared
 * browser loses unpublished work, which the studio says out loud, and export is
 * the answer to durability.
 */
import type { ParamSpec } from "./params";
import { withParams } from "./detect";
import type { PackagedProject } from "./project";

const DB = "aleatory-studio";
const STORE = "drafts";
const VERSION = 1;

export interface Draft {
    id: string;
    name: string;
    /** Runtime kind, from runtimes.ts. */
    kindId: number;
    /**
     * The generator, with its local files inlined. It carries the declared
     * parameters too, in `$alea.paramsSchema`: read with `detectParams`, written
     * with `withParams`. A copy beside the document is one that can disagree.
     */
    html: string;
    /** The seed the artist pinned as the one they look at. */
    seed: string;
    createdAt: number;
    updatedAt: number;
    /**
     * A generator this draft deployed that is not finished yet.
     *
     * Written the moment a large generator's contract is originated, before
     * any of its code has been sent. Code is append-only and a contract with
     * part of its art cannot mint, so an interrupted publish has to be
     * finishable: without this the only record of that address is a wallet the
     * artist closed, and the generator is stranded for good.
     *
     * Cleared when it seals.
     */
    pendingUpload?: string;
}

/**
 * One connection, reused: opening per call is a handshake per keystroke once
 * autosave is running. Dropped on `versionchange`, because a connection held
 * across one blocks the upgrade for every other tab.
 */
let connection: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
    if (connection) return connection;

    connection = new Promise<IDBDatabase>((resolve, reject) => {
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
                connection = null;
            };
            resolve(db);
        };
        req.onerror = () => {
            connection = null;
            reject(req.error ?? new Error("This browser refused to open its draft store."));
        };
        req.onblocked = () => {
            connection = null;
            reject(new Error("Another tab is holding the draft store open."));
        };
    });

    return connection;
}

/**
 * One transaction, resolved when it has happened. A write resolves on
 * `oncomplete`, the only event meaning it is on disk: `request.onsuccess` fires
 * when the request succeeded and not when the transaction committed, so a save
 * can resolve and then abort. Reads resolve on the request, having nothing to
 * commit.
 */
async function tx<T>(
    mode: IDBTransactionMode,
    fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
    const db = await open();
    return new Promise<T>((resolve, reject) => {
        try {
            const transaction = db.transaction(STORE, mode);
            const request = fn(transaction.objectStore(STORE));

            let result: T;
            request.onsuccess = () => {
                result = request.result;
                if (mode === "readonly") resolve(result);
            };
            request.onerror = () =>
                reject(request.error ?? new Error("That draft could not be read or written."));

            transaction.oncomplete = () => {
                if (mode !== "readonly") resolve(result);
            };
            const fail = (why: string) => () => {
                // A failed transaction can leave the connection unusable.
                connection = null;
                reject(transaction.error ?? new Error(why));
            };
            transaction.onerror = fail("That draft could not be saved.");
            transaction.onabort = fail("Saving that draft was interrupted.");
        } catch (err) {
            connection = null;
            reject(err);
        }
    });
}

export async function listDrafts(): Promise<Draft[]> {
    const all = await tx<Draft[]>("readonly", (s) => s.getAll() as IDBRequest<Draft[]>);
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getDraft(id: string): Promise<Draft | null> {
    const found = await tx<Draft | undefined>(
        "readonly",
        (s) => s.get(id) as IDBRequest<Draft | undefined>,
    );
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
        // Declared into the document when a kind supplies defaults.
        html: params.length > 0 ? withParams(project.html, params) : project.html,
        seed: randomSeed(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
    };
}

/** A seed to work against, shaped like the operation hash a real mint produces. */
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
