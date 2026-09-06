/**
 * Resolving a generator's declared libraries: this half fetches and verifies,
 * so it reaches for blake2b and the network. The catalog is data with no
 * dependency, in `kinds.ts`, and anything that only wants a kind's label should
 * import from there. Re-exported so an importer can take either.
 */
export * from "./kinds";
import type { DepSpec } from "./kinds";

export interface ResolvedDep {
    spec: DepSpec;
    source: string;
    bytes: number;
    /** blake2b-256 of the fetched source, hex. What v1 stores on chain. */
    hash: string;
}

const cache = new Map<string, ResolvedDep>();

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
 * The hash goes on chain immutably, so without one to check against, a CDN that
 * was compromised or republished a version would have its bytes inlined into an
 * artist's document and vouched for by the chain.
 *
 * The copy in `public/vendor` is ours and same-origin, and is checked anyway,
 * because a fork serving its own copy or a renderer pulling from npm has to
 * arrive at the identical answer or refuse to draw.
 *
 * Keyed by hash, never by name and version, so a generator declaring "p5 1.5.0"
 * with different bytes harms only itself.
 */
export async function resolveDep(spec: DepSpec): Promise<ResolvedDep> {
    // No hash yet is the first time anybody has asked for this package here.
    // The proxy resolves it against the digest published for that exact file
    // and answers with the blake2b to record.
    if (!spec.hash) return await firstResolve(spec);

    const cached = cache.get(spec.hash);
    if (cached) return cached;

    // Our own copy first, because it is one hop, then the proxy, which goes to
    // npm's mirrors server-side. Whichever answers, the bytes are checked.
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
 * A package with no recorded digest, fetched and hashed. Cached by coordinate,
 * since the hash is what is being learned. Once the piece is published, the
 * recorded digest is what every renderer checks and this path is not taken
 * again.
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
        // What was actually fetched, so publishing records the file that ran
        // and not the empty path the declaration left open.
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
