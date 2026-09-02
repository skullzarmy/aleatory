/**
 * Aleatory, the runtime kinds catalog.
 *
 * This is the v0 mirror of what becomes the on-chain **Runtimes** contract
 * (docs/aleatory/architecture.md §3). Kinds live in an append-only catalog
 * rather than an enum precisely so that adding a runtime in 2029 is one append
 * operation instead of a registry migration, and the v0 shape is deliberately
 * identical to the on-chain record so the swap is a data-source change.
 *
 * A kind is never edited. A better harness for a kind is a NEW kind_id, and
 * existing generators keep pointing at the old one, forever.
 */

/**
 * Where a piece's bytes live.
 *
 *   foc   in contract storage
 *   ipfs  on IPFS, content hash recorded on chain
 *
 * Only two, because a generator is always the whole piece. There was a third,
 * "shared", for code on chain that referenced a library resolved at render
 * time. That was never a storage class, it was a piece with a hole in it, and
 * the hole was filled by this website being in the room.
 *
 * Displayed on every piece. Not a ranking and not a gate: a collector should be
 * able to see where a work is kept before they buy it.
 */
export type StorageClassId = "foc" | "ipfs";

/**
 * A library a generator asks for instead of carrying.
 *
 * An artist can bundle anything they like, up to whatever fits. This exists so
 * they do not have to spend their bytes on p5: name a standard library and a
 * renderer loads it for them.
 *
 * What makes that safe to do is the hash, and what makes the hash trustworthy
 * is that we are not the authority behind it. The coordinates point at a public
 * registry, the registry publishes its own integrity digest, and anyone can
 * check ours against theirs at any time, forever, without asking us. We host a
 * copy for speed and we are never the thing being trusted.
 */
export interface DepSpec {
    /** Stable id, recorded in the generator record. */
    id: string;
    label: string;
    /** Pinned, never "latest". A generator records the version it was made against. */
    version: string;
    /** Registry coordinates. The independent authority anyone can re-check against. */
    registry: {
        /** `npm view p5@1.5.0 dist.integrity` returns this. */
        integrity: string;
        /** Path inside the published package. */
        path: string;
    };
    /**
     * A same-origin copy we serve ourselves, tried first because it is one
     * hop. Optional: without it the library resolves through /api/dep, which
     * fetches from npm's mirrors and verifies before answering.
     */
    url?: string;
    /** Approximate size, for the cost estimate before anything is fetched. */
    approxBytes: number;
    /**
     * blake2b-256 of the exact bytes, hex. Mandatory.
     *
     * This is what a generator records and what a renderer checks before it
     * runs anything. It was optional once and empty in practice, which meant
     * whatever a CDN happened to return got written into an artist's immutable
     * record with the chain vouching for it. There is no version of this that
     * is safe to leave blank.
     */
    hash: string;
}

export interface RuntimeKind {
    /** Matches the on-chain kind_id. Append-only: never reuse, never renumber. */
    kindId: number;
    name: string;
    label: string;
    /** The pinned dialect/library version recorded with a generator. */
    kindVersion: string;
    /** Human statement of the lifecycle contract this kind expects. */
    entrySpec: string;
    /** Libraries this kind needs resolved before boot. */
    deps: DepSpec[];
    /** Shown in the picker. */
    blurb: string;
}

/**
 * p5 1.5.0.
 *
 * Verified end to end, not copied off a CDN: the npm tarball was fetched from
 * registry.npmjs.org, checked against the `dist.integrity` npm publishes for
 * that exact version, and `lib/p5.min.js` extracted from it. The file in
 * `public/vendor` is that extraction, byte for byte.
 *
 * To re-check, from anything, with no reference to us:
 *
 *   npm view p5@1.5.0 dist.integrity
 *   npm pack p5@1.5.0 && tar xzOf p5-1.5.0.tgz package/lib/p5.min.js | sha256sum
 */
export const P5_DEP: DepSpec = {
    id: "p5",
    label: "p5.js",
    version: "1.5.0",
    registry: {
        integrity:
            "sha512-zZFMVUmGkXe2G5H6Sw7xsVhgdxMyEN/6SZnZqYdQ51513kTqPslLnukkwTbGf8YtW0RetTU0FTjYQMXnFD7KnQ==",
        path: "lib/p5.min.js",
    },
    url: "/vendor/p5-1.5.0.min.js",
    approxBytes: 898_364,
    hash: "16f48a5a83acb2a5c6d2597097de5c22e9230d4593ea08074372283817154d47",
};

/**
 * three.js 0.160.1.
 *
 * Derived the same way as p5 and checkable the same way:
 *
 *   npm view three@0.160.1 dist.integrity
 *   npm pack three@0.160.1 && tar xzOf three-0.160.1.tgz package/build/three.min.js | sha256sum
 *
 * Pinned at 0.160.1 because it is the last release shipping `three.min.js`,
 * the classic build that defines a global. Later versions ship ES modules
 * only, which a generator cannot use from a plain script tag, so moving this
 * version forward is a change to how a piece loads rather than a bump.
 *
 * No copy in public/vendor. It resolves through /api/dep, which is the path
 * every library that is not p5 will take.
 */
export const THREE_DEP: DepSpec = {
    id: "three",
    label: "three.js",
    version: "0.160.1",
    registry: {
        integrity:
            "sha512-Bgl2wPJypDOZ1stAxwfWAcJ0WQf7QzlptsxkjYiURPz+n5k4RBDLsq+6f9Y75TYxn6aHLcWz+JNmwTOXWrQTBQ==",
        path: "build/three.min.js",
    },
    approxBytes: 669_884,
    hash: "e354362d4ff40c102e735a89d84485cee221e4a381bc67132239fa1f369cb3e5",
};

/**
 * Every library a generator may declare.
 *
 * Separate from the runtime kinds. A kind says which harness a piece boots
 * under; a library is something any kind can ask for, and tying the two
 * together meant the catalog held exactly what the p5 kind depended on and
 * a custom piece asking for three.js was told its library was unknown.
 */
export const LIBRARIES: DepSpec[] = [P5_DEP, THREE_DEP];

export const RUNTIME_KINDS: RuntimeKind[] = [
    {
        kindId: 1,
        name: "vanilla",
        label: "Canvas 2D",
        kindVersion: "1",
        entrySpec:
            "Script runs on load; draws to a <canvas>; calls $alea.ready() at the capture point.",
        deps: [],
        blurb: "No dependencies. Fully on-chain.",
    },
    {
        kindId: 2,
        name: "svg",
        label: "SVG",
        kindVersion: "1",
        entrySpec: "Script builds an <svg> in the document; calls $alea.ready() when complete.",
        deps: [],
        blurb: "No dependencies, and the output is text. Fully on-chain.",
    },
    {
        kindId: 3,
        name: "p5",
        label: "p5.js",
        kindVersion: "1.5.0",
        entrySpec: "Standard p5 sketch (setup/draw). Call $alea.ready() at the capture point.",
        deps: [P5_DEP],
        blurb: "p5 is loaded for you, so your bytes go to your art.",
    },
    {
        kindId: 4,
        name: "custom",
        label: "Custom",
        kindVersion: "1",
        entrySpec:
            "Export window.ALEA_MAIN = { boot(ctx), render(ctx), features()?, resize(w,h)? } and call ctx.ready() at the capture point.",
        deps: [],
        blurb: "Any engine. Implement the lifecycle entry points.",
    },
];

export function getKind(kindId: number): RuntimeKind {
    return RUNTIME_KINDS.find((k) => k.kindId === kindId) ?? RUNTIME_KINDS[0];
}

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
