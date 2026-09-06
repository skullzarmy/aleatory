/**
 * The runtime kinds catalog. Data only: nothing here fetches and nothing here
 * has a dependency, so reading a kind's label does not pull in the resolution
 * half of `runtimes.ts` and its blake2b hashing.
 *
 * The v0 mirror of the on-chain Runtimes contract (docs/architecture.md §3),
 * with the same shape, so the swap is a change of data source. The catalog is
 * append-only: a kind is never edited, and a better harness for one is a new
 * kind_id that existing generators do not point at.
 */

/**
 * Where a piece's bytes live.
 *
 *   foc   in contract storage
 *   ipfs  on IPFS, content hash recorded on chain
 *
 * Displayed on every piece, so a collector can see where a work is kept before
 * they buy it.
 */
export type StorageClassId = "foc" | "ipfs";

/**
 * A library a generator asks for instead of carrying, so an artist's bytes go
 * to their art.
 *
 * The hash is what makes that safe, and the coordinates are what make the hash
 * checkable: they point at a public registry that publishes its own integrity
 * digest, so anyone can check ours against theirs without asking us. The copy
 * we host is for speed.
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
     * A same-origin copy, tried first. Without it the library resolves through
     * /api/dep, which fetches from npm's mirrors and verifies before answering.
     */
    url?: string;
    /** Approximate size, for the cost estimate before anything is fetched. */
    approxBytes: number;
    /**
     * blake2b-256 of the exact bytes, hex. What a generator records and what a
     * renderer checks before it runs anything. Never blank: an empty hash
     * writes whatever a CDN returned into an artist's immutable record.
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
 * p5 1.5.0. `public/vendor` holds `lib/p5.min.js` from the npm tarball, byte
 * for byte. To re-check, with no reference to us:
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
 * three.js 0.160.1, checkable the same way as p5:
 *
 *   npm view three@0.160.1 dist.integrity
 *   npm pack three@0.160.1 && tar xzOf three-0.160.1.tgz package/build/three.min.js | sha256sum
 *
 * The last release shipping `three.min.js`, the classic build that defines a
 * global. Later versions ship ES modules only, which a generator cannot load
 * from a plain script tag, so moving this forward changes how a piece loads.
 *
 * No copy in public/vendor: it resolves through /api/dep, the path every
 * library that is not p5 takes.
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
 * Every library a generator may declare, separate from the runtime kinds. A
 * kind says which harness a piece boots under; any kind can ask for any of
 * these.
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
