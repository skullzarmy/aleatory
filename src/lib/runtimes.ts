/**
 * Aleatory, resolving a generator's declared libraries.
 *
 * The catalog these describe lives in `kinds.ts`, which is data and has no
 * dependency. This half fetches and verifies, so it reaches for blake2b and
 * the network, and anything that only needs a kind's label should import from
 * `kinds.ts` rather than drag this in behind it.
 *
 * Re-exported here so every existing importer keeps working unchanged.
 */
export * from "./kinds";
import type { DepSpec } from "./kinds";

// ---------------------------------------------------------------------------
// Dependency resolution
// ---------------------------------------------------------------------------

export interface ResolvedDep {
    spec: DepSpec;
    source: string;
    bytes: number;
    /** blake2b-256 of the fetched source, hex. What v1 stores on chain. */
    hash: string;
}

const cache = new Map<string, ResolvedDep>();

/**
 * Fetch and hash a dependency, refusing anything that does not match what we
 * expect.
 *
 * The hash computed here is written into the generator record and goes on
 * chain immutably. Without a value to compare against, a CDN that was
 * compromised, intercepted, or that republished the version would have its
 * bytes inlined into an artist's document, executed in every viewer's
 * browser, and recorded on chain as canonical with the chain vouching for it.
 *
 * Resolution happens in the studio, never in a sandboxed frame: by the time a
 * piece runs, its libraries are inlined text and the frame has no network.
 */
/** blake2b-256, hex. CommonJS module, so both export shapes are handled. */
async function blake2b(bytes: Uint8Array): Promise<string> {
    const mod = (await import("blakejs")) as unknown as {
        blake2bHex?: typeof import("blakejs").blake2bHex;
        default?: { blake2bHex: typeof import("blakejs").blake2bHex };
    };
    const fn = mod.blake2bHex ?? mod.default?.blake2bHex;
    if (!fn) throw new Error("blakejs did not load.");
    return fn(bytes, undefined, 32);
}

/**
 * Load a library, and refuse it unless it is byte for byte what was recorded.
 *
 * The copy is ours, served same-origin out of `public/vendor`, so the app's
 * `connect-src` stays `'self'` and no CDN sits in the path. The hash is checked
 * anyway, every time, because serving the file is not the same as being trusted
 * for it: a fork serving its own copy, or a renderer pulling from npm, has to
 * arrive at the identical answer or refuse to draw.
 *
 * Keyed by hash, never by name and version. Otherwise a generator declaring
 * "p5 1.5.0" with different bytes would poison the entry every other p5 piece
 * reads, and a mislabelled library has to be able to harm only the piece that
 * asked for it.
 */
export async function resolveDep(spec: DepSpec): Promise<ResolvedDep> {
    // No hash yet means this is the first time anybody has asked for this
    // package here. The proxy resolves it against the digest published for
    // that exact file and answers with the blake2b to record, so the artist
    // does not have to supply one and we do not have to keep a list.
    if (!spec.hash) return await firstResolve(spec);

    const cached = cache.get(spec.hash);
    if (cached) return cached;

    // Our own copy first because it is one hop, then the proxy, which goes to
    // npm's mirrors server-side. Same order the renderer uses, and for the
    // same reason it is safe: whichever answers, the bytes are checked.
    const sources = [
        ...(spec.url ? [spec.url] : []),
        `/api/dep?id=${encodeURIComponent(spec.id)}` +
            `&version=${encodeURIComponent(spec.version)}` +
            `&path=${encodeURIComponent(spec.registry.path)}` +
            `&hash=${spec.hash}`,
    ];

    const failures: string[] = [];
    for (const url of sources) {
        let source: string;
        try {
            const res = await fetch(url);
            if (!res.ok) {
                failures.push(`${url} (${res.status})`);
                continue;
            }
            source = await res.text();
        } catch {
            failures.push(`${url} (unreachable)`);
            continue;
        }

        const bytes = new TextEncoder().encode(source);
        const hash = await blake2b(bytes);
        if (hash !== spec.hash) {
            failures.push(`${url} (hash ${hash})`);
            continue;
        }

        const resolved: ResolvedDep = { spec, source, bytes: bytes.length, hash };
        cache.set(spec.hash, resolved);
        return resolved;
    }

    throw new Error(
        `${spec.label} ${spec.version} could not be loaded. Tried: ${failures.join(", ")}`,
    );
}

/**
 * A package with no recorded digest, fetched and hashed.
 *
 * Cached by coordinate rather than by hash, since the hash is what is being
 * learned. Once the piece is published the recorded digest is what every
 * renderer checks against, and this path is not taken again for it.
 */
const firstCache = new Map<string, ResolvedDep>();

async function firstResolve(spec: DepSpec): Promise<ResolvedDep> {
    const coordinate = `${spec.id}@${spec.version}/${spec.registry.path}`;
    const cached = firstCache.get(coordinate);
    if (cached) return cached;

    const url =
        `/api/dep?id=${encodeURIComponent(spec.id)}` +
        `&version=${encodeURIComponent(spec.version)}` +
        (spec.registry.path ? `&path=${encodeURIComponent(spec.registry.path)}` : "");

    const res = await fetch(url);
    if (!res.ok) {
        throw new Error(
            `${spec.id}@${spec.version} could not be loaded. ${(await res.text()).split("\n")[0]}`,
        );
    }

    const source = await res.text();
    const bytes = new TextEncoder().encode(source);
    const hash = res.headers.get("x-alea-hash") ?? (await blake2b(bytes));

    const resolved: ResolvedDep = {
        // Carry back what was actually fetched, so publishing records the file
        // that ran rather than the empty path the declaration left open.
        spec: {
            ...spec,
            registry: {
                ...spec.registry,
                path: res.headers.get("x-alea-path") ?? spec.registry.path,
            },
            hash,
            approxBytes: bytes.length,
        },
        source,
        bytes: bytes.length,
        hash,
    };
    firstCache.set(coordinate, resolved);
    cache.set(hash, resolved);
    return resolved;
}

export async function resolveDeps(specs: DepSpec[]): Promise<ResolvedDep[]> {
    const out: ResolvedDep[] = [];
    for (const spec of specs) out.push(await resolveDep(spec));
    return out;
}
