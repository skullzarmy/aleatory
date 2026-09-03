/**
 * Reading npm, so a starter kit can be built out of packages.
 *
 * A declared library is loaded with a plain `<script>` tag, by the local
 * server while an artist works and by the renderer once a piece is published.
 * Most of npm cannot be loaded that way. A package whose default build is an ES
 * module or a CommonJS file assembles into a kit that looks right, loads
 * nothing, and renders a blank frame, which the artist discovers after minting,
 * when the piece can no longer be changed.
 *
 * `docs/libraries.md` names the case: three.js `0.160.1` is the last release
 * shipping a global build. That warning is a sentence an artist has to read and
 * remember. This module is the same knowledge, applied to whatever they picked,
 * before they download anything.
 *
 * Nothing here executes a package. A build says which of the three it is in its
 * wrapper, and names the global it defines there too, so this reads rather than
 * runs. Running somebody's npm package to find out what it is would be a far
 * larger claim on a visitor's browser than telling them what the file says
 * about itself.
 *
 * Reading it means reading all of it. The wrapper is at one end or the other
 * depending on the bundler, and jsDelivr compresses whatever is asked of it, so
 * a range lands mid-stream and decodes to nothing. Both ends are kept and the
 * middle is dropped once the bytes are here.
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

/**
 * What `/api/dep` will accept as a path, so nothing is offered that it refuses.
 *
 * Kept identical to the proxy's own rule on purpose. A coordinate this module
 * hands out is declared in a file that gets published, and the proxy is what
 * fetches it years later.
 */
export const DEP_PATH = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;

/**
 * How long a whole resolution gets.
 *
 * Under the ten seconds a serverless invocation is given, with room for the
 * response itself. Running out is reported as running out, never as a package
 * that cannot be loaded.
 */
export const BUDGET_MS = 7_000;

/**
 * The wrapper, wherever in the file it is and whichever branches it has.
 *
 * Two assumptions cost real libraries before this was written the way it is.
 *
 * **It is not always at the top.** `two.js@0.8.15` is 181,525 characters and
 * puts its wrapper at 181,446, after the whole bundle. Reading a prefix of the
 * file finds nothing and refuses a build that works.
 *
 * **The branches are optional.** A wrapper asks about CommonJS, or about AMD,
 * or both, depending on who generated it. `two.js` asks about `exports` and
 * never mentions `define`; `zdog` mentions `define.amd` and never says
 * `typeof exports`. Requiring both refused both.
 *
 * So: an AMD branch is conclusive on its own, since nothing but a wrapper asks
 * whether `define.amd` exists, and a CommonJS branch counts when it is a
 * question about the environment rather than a plain assignment.
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

/**
 * The parts of a build worth reading.
 *
 * A wrapper lives at one end or the other and the middle is the library, so
 * both ends are kept and the rest is dropped before any of the patterns below
 * are run over it. Whole files arrive here: jsDelivr compresses regardless of
 * what is asked of it, and a range over a compressed stream cannot be decoded
 * on its own, so reading the tail means having read all of it.
 */
const EDGE = 48_000;

function edges(text: string): string {
    if (text.length <= EDGE * 2) return text;
    return `${text.slice(0, EDGE)}\n/*…*/\n${text.slice(-EDGE)}`;
}

/**
 * The name a build puts on `window`, read off the wrapper's last branch.
 *
 * Two shapes cover what npm actually ships, verified against the four packages
 * most likely to be picked here:
 *
 *     factory(global.TWEEN = {})                    @tweenjs/tween.js
 *     ...t || self).THREE = {}                      three, d3
 *     ...typeof window ? window : this).p5 = e()    p5
 *
 * The first names the global directly. The second closes a paren on whatever
 * the global object turned out to be and assigns into it, which is what every
 * rollup build of the last several years emits.
 *
 * Null rather than a guess. A wrong global name is worse than none: it reads as
 * authoritative and sends somebody looking for a bug in their own code.
 */
export function globalNameIn(source: string): string | null {
    // Both ends, because a wrapper written as a footer names its global down
    // there and reading only the top finds nothing.
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

    // A wrapper that took the global object as a parameter and assigns onto it
    // by that name, which is what a hand written one usually does. Names walled
    // in underscores are skipped: `three` sets `window.__THREE__` for its
    // devtools and that is not what anybody types.
    const onRoot = /\b(?:root|global|self|window)\s*\.\s*([A-Za-z_$][\w$]*)\s*=\s*[A-Za-z_$]/.exec(
        text,
    );
    if (onRoot && !/^__.*__$/.test(onRoot[1])) return onRoot[1];

    // A bundle that is an expression assigned to one name, with a CommonJS
    // branch naming it. In a plain script the same declaration is the global.
    const viaExports = /\bmodule\.exports\s*=\s*([A-Za-z_$][\w$]*)\s*[;}\s]/.exec(text);
    if (viaExports && !/^__.*__$/.test(viaExports[1])) return viaExports[1];

    return null;
}

/**
 * What kind of build this is.
 *
 * The extension decides when it says anything: `.cjs` and `.mjs` are not
 * opinions. Otherwise both ends of the file are read, because a wrapper sits at
 * one end or the other and which end is the bundler's choice, not a rule.
 *
 * Ordered so the strongest evidence wins. A UMD wrapper contains
 * `module.exports` in one of its branches, so testing for CommonJS first would
 * call every UMD build CommonJS.
 */
export function classify(path: string, source: string): Flavor {
    if (path.endsWith(".cjs")) return "cjs";
    if (path.endsWith(".mjs")) return "esm";

    const text = edges(source);
    if (looksUmd(text)) return "umd";

    // Real module syntax, which cannot appear in a script a tag can load.
    //
    // The export list is looked for anywhere in the tail rather than anchored
    // to the end of it. `three@0.185.1/build/three.core.min.js` closes with an
    // export list some thousands of characters long, so a window measured back
    // from the end begins inside the braces and never sees the `export` that
    // opened them. That build was accepted as loadable, which would have handed
    // somebody a partial three.js that declares and then does not work.
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
 * Files in a package that might be a browser build, best first.
 *
 * Only consulted when the default will not load. The ranking is what package
 * authors actually name things: an explicit `umd` build first, then a
 * minified bundle in the usual directories, and never a file that has already
 * said it is a module.
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
 * How long the whole question gets, not how long one request gets.
 *
 * Resolving a package can mean a listing, a build, a version list, seven
 * probes and another few builds. Every one of those had its own deadline and
 * the chain had none, which is how `two.js` took twenty three seconds to
 * answer: comfortably past the ten a serverless invocation gets, so the answer
 * was never delivered at all. A per-request timeout does not bound a sequence
 * of requests.
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

/**
 * Anything past this is not a browser build somebody should be declaring, and
 * is not worth the time it takes to read.
 */
const TOO_LARGE = 8_000_000;

/**
 * A build, whole.
 *
 * Whole because a wrapper can be at either end and the tail cannot be fetched
 * on its own: jsDelivr compresses whatever is asked of it, `accept-encoding:
 * identity` included, so a range lands in the middle of a compressed stream
 * and decodes to nothing. Reading a prefix is what refused `two.js`, whose
 * wrapper begins at character 181,446 of 181,525.
 *
 * The transfer is compressed, so the common case is a couple of hundred
 * kilobytes on the wire, and the answer is cached against a pinned version
 * that can never change.
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

/**
 * One package, as much as can be known without running it.
 *
 * Two reads on the happy path: the listing, and the default build. A few more
 * when the default will not load and a sibling might.
 */
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

/**
 * The best sibling that actually loads.
 *
 * Bounded to a few candidates. This runs only when the default already failed,
 * and walking a whole package looking for a global build would turn one
 * person's search box into a lot of somebody else's bandwidth.
 */
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
 * Cheap enough to probe with: a path that could not possibly be a script build.
 *
 * Used as the predicate of the search below, where the cost of reading a file's
 * bytes for every candidate is the difference between an answer and a wait.
 * The version it settles on is inspected properly before anybody is told about
 * it, so a wrong guess here costs one extra probe and never a wrong answer.
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
 * The newest version of a package that a script tag can still load.
 *
 * Searching rather than scanning. `three` has 312 published versions and the
 * last one with a global build is thirty-four back from the newest, so walking
 * them is thirty-four requests to answer the single most likely question this
 * feature will ever be asked.
 *
 * A package that drops its global build does not bring it back, so the list is
 * ordered by whether it loads and the boundary can be found by halving. That
 * assumption is doing real work here: if a package ever did restore one, this
 * finds a version that loads rather than necessarily the newest, which is a
 * worse answer and still a working one.
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

    // The predicate above reads a filename. This reads the file.
    const inspection = await inspect(id, window[found], budget).catch(() => null);
    if (inspection?.loadable) return { version: window[found], inspection };

    // The boundary was off by a little. Take the next few honestly rather than
    // hand back something that does not load.
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
 * A package, turned into something declarable, or an honest no.
 *
 * Three answers in order of preference: the version asked for, another file in
 * that version, or an older version. Searching npm hands back the newest
 * release, and for most packages of any age the newest release is a module, so
 * without the third of those the common path through this feature ends in a
 * refusal and the artist is sent to do version archaeology by hand.
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

    // A path that names a file has to survive the dependency proxy, which is
    // stricter about what a path may contain than a package registry is.
    // Offering one it will refuse builds a kit whose library cannot be fetched
    // at publish, which is the worst moment to find out.
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

/**
 * npm's search, trimmed to what a picker shows.
 *
 * The registry's own endpoint, so the results are the ones somebody would get
 * on npmjs.com. It answers with a great deal more than this about each package,
 * none of which belongs on the way to choosing a library.
 */
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
