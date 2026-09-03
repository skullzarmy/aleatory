/**
 * Reading npm well enough to know whether a package can be declared.
 *
 * A declared library is loaded with a plain `<script>` tag. Most of npm cannot
 * be: an ES module or a CommonJS default build loads nothing and renders a
 * blank frame. See docs/libraries.md.
 *
 * Nothing here executes a package. A build states its flavour and names its
 * global in its wrapper, so this reads rather than runs.
 */

/** How a build expects to be loaded. Only `umd` and `global` work from a tag. */
export type Flavor = "umd" | "global" | "esm" | "cjs" | "unknown";

export interface Inspection {
    id: string;
    version: string;
    /** The file a bare coordinate resolves to. No leading slash. */
    path: string;
    bytes: number;
    flavor: Flavor;
    /** Whether a `<script>` tag can load it. */
    loadable: boolean;
    /** What it puts on `window`, when the wrapper says. Null when it does not. */
    global: string | null;
    /**
     * A file in the same version that would load, when the default will not.
     *
     * Packages that ship several builds are the common case, and naming the
     * file is already how a declaration asks for one: the coordinate becomes
     * `@tweenjs/tween.js@23.1.3/dist/tween.umd.js`. Finding it here is the
     * difference between that escape hatch existing and anybody using it.
     */
    alternate: { path: string; global: string | null; bytes: number } | null;
    /** Said to the artist when `loadable` is false. */
    why: string | null;
}

// npm's own naming rules, and nothing that could climb out of a path. Same
// shapes the dependency proxy validates against, for the same reason.
export const ID = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
export const VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/;

/** Identical to `/api/dep`'s own rule, so nothing is offered that it refuses. */
export const DEP_PATH = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;

/** The whole resolution's budget, under the ten seconds an invocation gets. */
export const BUDGET_MS = 7_000;

/**
 * The wrapper, wherever in the file it is and whichever branches it has.
 *
 * A wrapper sits at either end: `two.js@0.8.15` puts its at character 181,446
 * of 181,525. Its branches are optional, and which ones it has depends on the
 * bundler: `two.js` asks about `exports` and never mentions `define`, `zdog`
 * mentions `define.amd` and never says `typeof exports`.
 *
 * An AMD branch is conclusive on its own, since nothing but a wrapper asks
 * whether `define.amd` exists. A CommonJS branch counts when it is a question
 * about the environment rather than a plain assignment.
 */
function looksUmd(text: string): boolean {
    if (/define\.amd/.test(text)) return true;

    const asksExports =
        /typeof\s+exports\s*===?\s*["']object["']/.test(text) ||
        /["']object["']\s*==\s*typeof\s+exports/.test(text);
    const asksModule =
        /typeof\s+module\s*!==?\s*["']undefined["']/.test(text) ||
        /["']undefined["']\s*!=\s*typeof\s+module/.test(text);

    return asksExports && asksModule;
}

/** A wrapper is at one end or the other; the middle is the library. */
const EDGE = 48_000;

function edges(text: string): string {
    if (text.length <= EDGE * 2) return text;
    return `${text.slice(0, EDGE)}\n/*…*/\n${text.slice(-EDGE)}`;
}

/**
 * The name a build puts on `window`, read off the wrapper's global branch.
 *
 *     factory(global.TWEEN = {})                    @tweenjs/tween.js
 *     ...t || self).THREE = {}                      three, d3
 *     ...typeof window ? window : this).p5 = e()    p5
 *
 * Null rather than a guess: a wrong name reads as authoritative.
 */
export function globalNameIn(source: string): string | null {
    const text = edges(source);

    const direct =
        /factory\s*\(\s*(?:global|globalThis|self|window|root)\s*\.\s*([A-Za-z_$][\w$]*)\s*=/.exec(
            text,
        );
    if (direct) return direct[1];

    const viaParen = /(?:globalThis|self|window|this)\s*\)\s*\.\s*([A-Za-z_$][\w$]*)\s*=/.exec(
        text,
    );
    if (viaParen) return viaParen[1];

    // A hand written wrapper assigning onto the global it was passed. Names
    // walled in underscores are internal markers, like three's `__THREE__`.
    const onRoot = /\b(?:root|global|self|window)\s*\.\s*([A-Za-z_$][\w$]*)\s*=\s*[A-Za-z_$]/.exec(
        text,
    );
    if (onRoot && !/^__.*__$/.test(onRoot[1])) return onRoot[1];

    // A bundle assigned to one name, which in a plain script is the global.
    const viaExports = /\bmodule\.exports\s*=\s*([A-Za-z_$][\w$]*)\s*[;}\s]/.exec(text);
    if (viaExports && !/^__.*__$/.test(viaExports[1])) return viaExports[1];

    return null;
}

/**
 * What kind of build this is. The extension decides where it says anything.
 *
 * Ordered so the strongest evidence wins: a UMD wrapper carries
 * `module.exports` in a branch, so testing CommonJS first would catch them all.
 */
export function classify(path: string, source: string): Flavor {
    if (path.endsWith(".cjs")) return "cjs";
    if (path.endsWith(".mjs")) return "esm";

    const text = edges(source);
    if (looksUmd(text)) return "umd";

    // Real module syntax, which cannot appear in a script a tag can load.
    //
    // Anywhere in the tail, not anchored to the end of it.
    // `three@0.185.1/build/three.core.min.js` closes with an export list some
    // thousands of characters long, so a window measured back from the end
    // begins inside the braces and never sees the `export` that opened them.
    if (/^\s*import\s[\s\S]{0,200}?\sfrom\s*["']/m.test(text)) return "esm";
    if (/^\s*export\s+(?:default|const|let|var|function|class|\{)/m.test(text)) return "esm";
    if (/\bexport\s*\{/.test(text)) return "esm";
    if (/\bexport\s+default\b/.test(text)) return "esm";

    // Nothing asked for a module system, so a plain script that assigns onto
    // the window is what is left. That is most of the older web.
    if (/\b(?:window|self|globalThis)\s*\.\s*[A-Za-z_$][\w$]*\s*=/.test(text)) return "global";

    if (/\bmodule\.exports\b|\bexports\.[A-Za-z_$]/.test(text)) return "cjs";

    return "unknown";
}

export function loadableFlavor(flavor: Flavor): boolean {
    return flavor === "umd" || flavor === "global";
}

/** What to tell somebody whose pick will not load. */
export function whyNot(flavor: Flavor, id: string): string | null {
    switch (flavor) {
        case "esm":
            return `${id}'s default build is an ES module, which a script tag cannot load.`;
        case "cjs":
            return `${id}'s default build is a CommonJS file, which only works under a bundler.`;
        case "unknown":
            return `Nothing in ${id}'s default build says how it expects to be loaded.`;
        default:
            return null;
    }
}

/**
 * Files that might be a browser build, best first. Ranked the way package
 * authors name things, and never a file that has said it is a module.
 */
export function browserCandidates(paths: string[]): string[] {
    const denied = /\.(?:cjs|mjs)$|\.(?:module|esm|es)\.js$|\.d\.ts$/;
    const usual = /^(?:dist|build|lib|umd|browser)\//;

    return paths
        .filter((p) => p.endsWith(".js") && !denied.test(p))
        .map((p) => {
            let score = 0;
            if (/\.umd(?:\.min)?\.js$/.test(p)) score += 100;
            if (/\bumd\b/.test(p)) score += 40;
            if (/\.min\.js$/.test(p)) score += 20;
            if (usual.test(p)) score += 10;
            // A shallower file is more likely the package's own build than
            // something under examples/ or test/.
            score -= p.split("/").length;
            if (/^(?:examples?|tests?|src|node_modules)\//.test(p)) score -= 200;
            return { p, score };
        })
        .filter((c) => c.score > -100)
        .sort((a, b) => b.score - a.score)
        .map((c) => c.p);
}

// ---------------------------------------------------------------------------
// Reading jsDelivr
// ---------------------------------------------------------------------------

const DATA = "https://data.jsdelivr.com/v1/packages/npm";
const CDN = "https://cdn.jsdelivr.net/npm";

/**
 * How long the whole question gets, not one request.
 *
 * Resolving can mean a listing, a build, a version list, seven probes and a
 * few more builds. A deadline on each bounds none of them together.
 */
export class Budget {
    private readonly until: number;

    constructor(ms: number) {
        this.until = Date.now() + ms;
    }

    get left(): number {
        return this.until - Date.now();
    }

    get spent(): boolean {
        return this.left <= 0;
    }
}

/** Raised when the budget runs out. Distinct from a package that will not load. */
export class OutOfTime extends Error {
    constructor() {
        super("Took too long to check.");
        this.name = "OutOfTime";
    }
}

/** One attempt, never longer than what is left of the whole question. */
async function ask(url: string, budget: Budget, init: RequestInit = {}): Promise<Response> {
    if (budget.spent) throw new OutOfTime();
    return fetch(url, {
        ...init,
        signal: AbortSignal.timeout(Math.min(6_000, budget.left)),
    });
}

interface Entry {
    type: string;
    name: string;
    size?: number;
    files?: Entry[];
}

interface Listing {
    default?: string;
    files?: Entry[];
}

/** Every file in a package, flattened to paths, with sizes. */
function flatten(files: Entry[], prefix = ""): { path: string; bytes: number }[] {
    const out: { path: string; bytes: number }[] = [];
    for (const f of files) {
        const path = prefix ? `${prefix}/${f.name}` : f.name;
        if (f.type === "directory") out.push(...flatten(f.files ?? [], path));
        else out.push({ path, bytes: f.size ?? 0 });
    }
    return out;
}

/** Past this it is not a browser build worth declaring. */
const TOO_LARGE = 8_000_000;

/**
 * A build, whole. The tail cannot be fetched alone: jsDelivr compresses
 * whatever is asked of it, `accept-encoding: identity` included, so a range
 * lands mid-stream and decodes to nothing. The transfer itself is compressed.
 */
async function readBuild(
    id: string,
    version: string,
    path: string,
    bytes: number,
    budget: Budget,
): Promise<string> {
    if (bytes > TOO_LARGE) throw new Error(`${path} is too large to check.`);
    const res = await ask(`${CDN}/${id}@${version}/${path}`, budget);
    if (!res.ok) throw new Error(`${path} returned ${res.status}`);
    return res.text();
}

/** Two reads on the happy path: the listing, and the default build. */
export async function inspect(
    id: string,
    version: string,
    budget = new Budget(BUDGET_MS),
): Promise<Inspection> {
    const res = await ask(`${DATA}/${id}@${version}`, budget);
    if (!res.ok) throw new Error(`No ${id}@${version} on npm (${res.status}).`);
    const listing = (await res.json()) as Listing;

    const files = flatten(listing.files ?? []);
    const path = (listing.default ?? "").replace(/^\//, "");

    const base: Inspection = {
        id,
        version,
        path,
        bytes: files.find((f) => f.path === path)?.bytes ?? 0,
        flavor: "unknown",
        loadable: false,
        global: null,
        alternate: null,
        why: null,
    };

    if (!path) {
        return {
            ...base,
            why: `${id}@${version} declares no default build, so the file has to be named.`,
        };
    }

    const source = await readBuild(id, version, path, base.bytes, budget);
    const flavor = classify(path, source);

    if (loadableFlavor(flavor)) {
        return { ...base, flavor, loadable: true, global: globalNameIn(source) };
    }

    // The default will not load. Something else in the package might, and
    // naming a file is already how a declaration asks for one.
    const alternate = await firstLoadable(id, version, files, path, budget);

    return { ...base, flavor, loadable: false, why: whyNot(flavor, id), alternate };
}

/** The best sibling that loads. Bounded: this runs only after the default failed. */
async function firstLoadable(
    id: string,
    version: string,
    files: { path: string; bytes: number }[],
    exclude: string,
    budget: Budget,
): Promise<Inspection["alternate"]> {
    const candidates = browserCandidates(files.map((f) => f.path))
        .filter((p) => p !== exclude)
        .slice(0, 3);

    for (const candidate of candidates) {
        if (budget.spent) break;
        try {
            const size = files.find((f) => f.path === candidate)?.bytes ?? 0;
            const source = await readBuild(id, version, candidate, size, budget);
            if (!loadableFlavor(classify(candidate, source))) continue;
            return {
                path: candidate,
                global: globalNameIn(source),
                bytes: files.find((f) => f.path === candidate)?.bytes ?? 0,
            };
        } catch {
            /* try the next one */
        }
    }
    return null;
}

// ---------------------------------------------------------------------------
// Finding a version that works
// ---------------------------------------------------------------------------

/**
 * The search predicate below, from a filename alone. Whatever it settles on is
 * inspected properly afterwards, so a wrong guess costs a probe, not an answer.
 */
function pathCouldLoad(path: string): boolean {
    if (!path) return false;
    const clean = path.replace(/^\//, "");
    return clean.endsWith(".js") && !/\.(?:module|esm|es)\.js$/.test(clean);
}

async function defaultPathFor(id: string, version: string, budget: Budget): Promise<string> {
    const res = await ask(`${DATA}/${id}@${version}`, budget);
    if (!res.ok) return "";
    return ((await res.json()) as Listing).default ?? "";
}

/**
 * The newest version a script tag can still load, found by halving.
 *
 * `three` has 312 versions and the last with a global build is 34 back, so
 * scanning is 34 requests. A package that drops its global build does not
 * restore it, so the list is ordered by whether it loads. Where that does not
 * hold this finds a version that loads rather than the newest.
 */
export async function newestLoadable(
    id: string,
    versions: string[],
    budget: Budget,
): Promise<{ version: string; inspection: Inspection } | null> {
    // Newest first, and only the recent past. Nobody wants a five year old
    // release, and the boundary is never that far back in practice.
    const window = versions.slice(0, 80);
    if (window.length === 0) return null;

    let low = 0;
    let high = window.length - 1;
    let found = -1;

    while (low <= high) {
        if (budget.spent) throw new OutOfTime();
        const mid = (low + high) >> 1;
        const path = await defaultPathFor(id, window[mid], budget).catch(() => "");
        if (pathCouldLoad(path)) {
            found = mid;
            high = mid - 1; // something newer might also load
        } else {
            low = mid + 1;
        }
    }

    if (found === -1) return null;

    // The predicate reads a filename. This reads the file.
    const inspection = await inspect(id, window[found], budget).catch(() => null);
    if (inspection?.loadable) return { version: window[found], inspection };

    // Boundary off by a little: take the next few rather than one that fails.
    for (const version of window.slice(found + 1, found + 4)) {
        if (budget.spent) throw new OutOfTime();
        const next = await inspect(id, version, budget).catch(() => null);
        if (next?.loadable) return { version, inspection: next };
    }
    return null;
}

async function versionsOf(id: string, budget: Budget): Promise<string[]> {
    const res = await ask(`${DATA}/${id}`, budget);
    if (!res.ok) return [];
    const body = (await res.json()) as { versions?: { version: string }[] };
    return (body.versions ?? []).map((v) => v.version).filter((v) => VERSION.test(v));
}

export interface Resolution {
    /** Exactly what to put in the meta tag. Null when nothing in the package works. */
    coordinate: string | null;
    inspection: Inspection;
    /** What the global is called, when it could be read. */
    global: string | null;
    bytes: number;
    /** One line saying what had to change, when anything did. */
    note: string | null;
}

/**
 * A package turned into something declarable, or an honest no. In order: the
 * version asked for, another file in it, an older version. Search returns the
 * newest release, which for most packages of age is a module.
 */
export async function resolve(
    id: string,
    version: string,
    budget = new Budget(BUDGET_MS),
): Promise<Resolution> {
    const inspection = await inspect(id, version, budget);

    if (inspection.loadable) {
        return {
            coordinate: `${id}@${version}`,
            inspection,
            global: inspection.global,
            bytes: inspection.bytes,
            note: null,
        };
    }

    // The proxy is stricter about paths than the registry is, and it is what
    // fetches this at publish.
    if (inspection.alternate && DEP_PATH.test(inspection.alternate.path)) {
        return {
            coordinate: `${id}@${version}/${inspection.alternate.path}`,
            inspection,
            global: inspection.alternate.global,
            bytes: inspection.alternate.bytes,
            note: `${version}'s default build cannot be loaded from a script tag, so this names ${inspection.alternate.path} instead.`,
        };
    }

    const older = await newestLoadable(id, await versionsOf(id, budget), budget).catch((e) => {
        if (e instanceof OutOfTime) throw e;
        return null;
    });
    if (older) {
        return {
            coordinate: `${id}@${older.version}`,
            inspection: older.inspection,
            global: older.inspection.global,
            bytes: older.inspection.bytes,
            note: `${version} cannot be loaded from a script tag. ${older.version} is the newest that can.`,
        };
    }

    return {
        coordinate: null,
        inspection,
        global: null,
        bytes: 0,
        note:
            inspection.why ??
            `No build of ${id} can be loaded from a script tag. Bundle it into your file instead.`,
    };
}

// ---------------------------------------------------------------------------
// Searching npm
// ---------------------------------------------------------------------------

export interface Hit {
    id: string;
    version: string;
    description: string;
    /** npm's own popularity figure, 0 to 1. Used only to order results. */
    popularity: number;
}

/** npm's own search endpoint, trimmed to what a picker shows. */
export async function search(text: string, limit = 12): Promise<Hit[]> {
    const url = new URL("https://registry.npmjs.org/-/v1/search");
    url.searchParams.set("text", text);
    url.searchParams.set("size", String(Math.min(limit, 25)));

    const res = await ask(url.toString(), new Budget(BUDGET_MS));
    if (!res.ok) throw new Error(`npm search returned ${res.status}`);

    const body = (await res.json()) as {
        objects?: {
            package?: { name?: string; version?: string; description?: string };
            score?: { detail?: { popularity?: number } };
        }[];
    };

    return (body.objects ?? []).flatMap((o) => {
        const name = o.package?.name;
        const version = o.package?.version;
        if (!name || !version || !ID.test(name) || !VERSION.test(version)) return [];
        return [
            {
                id: name,
                version,
                description: o.package?.description ?? "",
                popularity: o.score?.detail?.popularity ?? 0,
            },
        ];
    });
}
