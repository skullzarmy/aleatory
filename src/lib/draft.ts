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
     * The generator, with its local files already inlined.
     *
     * It carries the declared parameters too, in `$alea.paramsSchema`, the way
     * it carries declared libraries in a meta tag. Read them with
     * `detectParams`, write them with `withParams`. A second copy beside the
     * document is a copy that can disagree with it.
     */
    html: string;
    /** The seed the artist pinned as the one they look at. */
    seed: string;
    createdAt: number;
    updatedAt: number;
}

/**
 * One connection, reused.
 *
 * Opening per call is a handshake per keystroke once autosave is running, and
 * a connection left open across a version change blocks the upgrade for every
 * other tab. Dropped on `versionchange` so the next call opens cleanly.
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
 * One transaction, resolved when it has actually happened.
 *
 * A write resolves on `oncomplete`, the only event that means it is on disk.
 * `request.onsuccess` fires when the request succeeded and not when the
 * transaction committed, so a save can resolve and then abort.
 *
 * Reads resolve on the request: there is nothing to commit.
 *
 * Found by @webid in #1.
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
        // Declared into the document when a kind supplies defaults, so the
        // starting point is a file that says what it wants, like any other.
        html: params.length > 0 ? withParams(project.html, params) : project.html,
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
