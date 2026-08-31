/**
 * Resolving the libraries a piece declared.
 *
 * A collection records, in its own metadata, the libraries its generator
 * expects a renderer to load:
 *
 *   [{ "id": "p5", "version": "1.5.0", "path": "lib/p5.min.js", "hash": "…" }]
 *
 * That is deliberately enough for a renderer that has never heard of Aleatory.
 * `id` and `version` are npm coordinates, `path` locates the file inside the
 * published package, and `hash` decides whether what came back is usable. Any
 * mirror will do because none of them is trusted: the bytes either hash to the
 * recorded value or they are refused.
 *
 * This provider tries its own site first, since it serves verified copies of
 * the libraries its studio offers, then unpkg. A third-party provider is free
 * to try anything at all in any order, and will arrive at identical bytes or
 * at an error.
 */
// blakejs is CommonJS. A named import works under a bundler and throws under
// plain Node, which is where the daemon runs, so the default export is
// destructured instead.
import blakejs from "blakejs";

const { blake2bHex } = blakejs;

export interface DeclaredLibrary {
    id: string;
    version: string;
    /** Path inside the published package. */
    path: string;
    /** blake2b-256, hex. */
    hash: string;
}

/** Our own deployment, which serves verified copies. Netlify sets `URL`. */
const SITE = (process.env.URL || process.env.DEPLOY_URL || "").replace(/\/$/, "");

const cache = new Map<string, string>();

export function parseLibraries(json: string | undefined): DeclaredLibrary[] {
    if (!json) return [];
    try {
        const raw = JSON.parse(json) as unknown;
        if (!Array.isArray(raw)) return [];
        return raw.filter(
            (l): l is DeclaredLibrary =>
                typeof l === "object" &&
                l !== null &&
                typeof (l as DeclaredLibrary).id === "string" &&
                typeof (l as DeclaredLibrary).version === "string" &&
                typeof (l as DeclaredLibrary).hash === "string",
        );
    } catch {
        return [];
    }
}

function sourcesFor(lib: DeclaredLibrary): string[] {
    const path = lib.path || "";
    const out: string[] = [];
    if (SITE) out.push(`${SITE}/vendor/${lib.id}-${lib.version}.min.js`);
    out.push(`https://unpkg.com/${lib.id}@${lib.version}/${path}`);
    out.push(`https://cdn.jsdelivr.net/npm/${lib.id}@${lib.version}/${path}`);
    return out;
}

/**
 * One library, verified.
 *
 * Every candidate is checked against the recorded hash, so a mirror that is
 * out of date, wrong, or hostile is skipped rather than used. Running out of
 * candidates is a hard failure: a piece rendered without the library it asked
 * for is not that piece, and publishing an image of an empty frame is worse
 * than publishing nothing.
 */
async function resolveOne(lib: DeclaredLibrary): Promise<string> {
    if (!/^[0-9a-f]{64}$/.test(lib.hash)) {
        throw new Error(`${lib.id}@${lib.version} declares no usable hash`);
    }
    const hit = cache.get(lib.hash);
    if (hit) return hit;

    const tried: string[] = [];
    for (const url of sourcesFor(lib)) {
        try {
            const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
            if (!res.ok) {
                tried.push(`${url} (${res.status})`);
                continue;
            }
            const source = await res.text();
            const hash = blake2bHex(new TextEncoder().encode(source), undefined, 32);
            if (hash !== lib.hash) {
                tried.push(`${url} (hash ${hash.slice(0, 12)}…)`);
                continue;
            }
            cache.set(lib.hash, source);
            return source;
        } catch (e) {
            tried.push(`${url} (${e instanceof Error ? e.message : e})`);
        }
    }

    throw new Error(
        `${lib.id}@${lib.version} could not be resolved to its recorded hash. Tried: ${tried.join(", ")}`,
    );
}

/** In declaration order, because a library that lands late is one nothing used. */
export async function resolveLibraries(libs: DeclaredLibrary[]): Promise<string[]> {
    const out: string[] = [];
    for (const lib of libs) out.push(await resolveOne(lib));
    return out;
}
