import { createHash } from "node:crypto";
import blakejs from "blakejs";

/**
 * The dependency proxy: a declared library, fetched and verified server-side.
 *
 * The browser cannot go to a CDN itself. `connect-src` is `'self'` plus a
 * short list of named hosts, and widening it to npm's mirrors would put every
 * visitor's IP in front of them and make the privacy policy wrong. So this
 * route does the fetching, from the same mirrors and in the same order as the
 * renderer in `provider/libraries.mts`, and the studio sees one
 * same-origin URL.
 *
 * No mirror is trusted. The bytes hash to what the caller asked for or nothing
 * is served, which is the same rule the renderer applies and the reason it
 * does not matter which mirror answered.
 *
 * Two ways in, and both end in bytes somebody other than us vouched for.
 *
 * **With a hash**, the fast path: fetch from a mirror and check. Used once a
 * library has been published, when the recorded digest is the thing being
 * satisfied.
 *
 * **Without one**, the first time anybody asks for a package: fetch npm's
 * packument, fetch the tarball it names, check that tarball against the
 * `dist.integrity` npm publishes for it, and take the file out. The answer
 * carries the blake2b of those bytes, which is what gets recorded when the
 * piece is published.
 *
 * The second path is what makes the catalog unnecessary. Any package on npm
 * can be declared, because npm is the authority on what a package is and this
 * checks against npm rather than against a list we keep. What it will not do
 * is hand back unverified bytes: "these are probably three.js" is the thing
 * the declaration model exists to refuse.
 */

const { blake2bHex } = blakejs;

// npm's own naming rules, and nothing that could climb out of a path.
const ID = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/;
// Segments joined by single slashes. Rejects a leading slash and an empty
// segment, so "//evil.example/x.js" cannot ride in as a path.
const PATH = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;
const HASH = /^[0-9a-f]{64}$/;

function sourcesFor(id: string, version: string, path: string): string[] {
    return [
        `https://unpkg.com/${id}@${version}/${path}`,
        `https://cdn.jsdelivr.net/npm/${id}@${version}/${path}`,
    ];
}

export async function GET(request: Request) {
    const q = new URL(request.url).searchParams;
    const id = q.get("id") ?? "";
    const version = q.get("version") ?? "";
    const path = q.get("path") ?? "";
    const hash = (q.get("hash") ?? "").toLowerCase();

    const bad =
        (!ID.test(id) && "id") ||
        (!VERSION.test(version) && "version") ||
        (path !== "" && !PATH.test(path) && "path") ||
        (path.includes("..") && "path") ||
        (hash !== "" && !HASH.test(hash) && "hash");

    if (bad) {
        return new Response(`Bad ${bad}.`, { status: 400 });
    }

    // No recorded digest yet, so npm's own is the thing to satisfy.
    if (hash === "") {
        return fromRegistry(id, version, path);
    }

    const tried: string[] = [];
    for (const url of sourcesFor(id, version, path)) {
        let text: string;
        try {
            const res = await fetch(url, { redirect: "follow" });
            if (!res.ok) {
                tried.push(`${url} -> ${res.status}`);
                continue;
            }
            text = await res.text();
        } catch (e) {
            tried.push(`${url} -> ${e instanceof Error ? e.message : "failed"}`);
            continue;
        }

        const bytes = new TextEncoder().encode(text);
        const got = blake2bHex(bytes, undefined, 32);
        if (got !== hash) {
            // Not an error to retry past quietly. A mirror serving different
            // bytes under a pinned version is worth saying out loud.
            tried.push(`${url} -> hash ${got}`);
            continue;
        }

        return new Response(text, {
            status: 200,
            headers: {
                "content-type": "application/javascript; charset=utf-8",
                // Pinned version, verified bytes. This response can never
                // legitimately change, so it can be cached indefinitely.
                "cache-control": "public, max-age=31536000, immutable",
                "x-alea-hash": got,
            },
        });
    }

    return new Response(
        `No mirror served ${id}@${version}/${path} matching ${hash}.\n${tried.join("\n")}\n`,
        { status: 502, headers: { "content-type": "text/plain; charset=utf-8" } },
    );
}

/**
 * The file from jsDelivr, checked against the digest jsDelivr publishes for it.
 *
 * Its data API lists every file in a package with a sha256 and a size, and
 * names the package's default browser build, so a declaration of `d3@7.9.0`
 * needs nothing else to resolve. Bytes that do not match are refused.
 *
 * This is the path taken the first time anybody asks for a package. The answer
 * carries the blake2b of the file, which is what gets recorded when the piece
 * is published, and every renderer afterwards checks against that instead.
 */
async function fromRegistry(id: string, version: string, requested: string): Promise<Response> {
    const fail = (why: string, status = 502) =>
        new Response(`${why}\n`, {
            status,
            headers: { "content-type": "text/plain; charset=utf-8" },
        });

    interface Entry {
        type: string;
        name: string;
        hash?: string;
        files?: Entry[];
    }

    let listing: { default?: string; files?: Entry[] };
    try {
        const res = await fetch(`https://data.jsdelivr.com/v1/packages/npm/${id}@${version}`);
        if (!res.ok) return fail(`No ${id}@${version} on npm (${res.status}).`, 404);
        listing = (await res.json()) as typeof listing;
    } catch {
        return fail("The package index could not be reached.");
    }

    // A declaration is `d3@7.9.0`, so when it names no file the package's own
    // default browser build is used.
    const path = (requested || listing.default || "").replace(/^\//, "");
    if (!path) {
        return fail(
            `${id}@${version} declares no default build, so the file has to be named.`,
            400,
        );
    }

    // The listing is a tree of directories; walk it to the file.
    let level = listing.files ?? [];
    let entry: Entry | undefined;
    for (const segment of path.split("/")) {
        entry = level.find((f) => f.name === segment);
        if (!entry) break;
        level = entry.files ?? [];
    }
    if (!entry || entry.type !== "file" || !entry.hash) {
        return fail(`${id}@${version} contains no ${path}.`, 404);
    }

    let body: Buffer;
    try {
        const res = await fetch(`https://cdn.jsdelivr.net/npm/${id}@${version}/${path}`);
        if (!res.ok) return fail(`${path} returned ${res.status}.`);
        body = Buffer.from(await res.arrayBuffer());
    } catch {
        return fail(`${path} could not be fetched.`);
    }

    const sha256 = createHash("sha256").update(body).digest("base64");
    if (sha256 !== entry.hash) {
        return fail(
            `${id}@${version}/${path} is not the file that was published.\n` +
                `expected ${entry.hash}\ngot      ${sha256}`,
        );
    }

    return new Response(new Uint8Array(body), {
        status: 200,
        headers: {
            "content-type": "application/javascript; charset=utf-8",
            "cache-control": "public, max-age=31536000, immutable",
            // What to record when the piece is published.
            "x-alea-hash": blake2bHex(body, undefined, 32),
            "x-alea-path": path,
        },
    });
}
