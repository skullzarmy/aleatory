import blakejs from "blakejs";

/**
 * The dependency proxy: a declared library, fetched and verified server-side.
 *
 * The browser cannot go to a CDN itself. `connect-src` is `'self'` plus a
 * short list of named hosts, and widening it to npm's mirrors would put every
 * visitor's IP in front of them and make the privacy policy wrong. So this
 * route does the fetching, from the same mirrors and in the same order as the
 * renderer in `netlify/functions/lib/libraries.mts`, and the studio sees one
 * same-origin URL.
 *
 * No mirror is trusted. The bytes hash to what the caller asked for or nothing
 * is served, which is the same rule the renderer applies and the reason it
 * does not matter which mirror answered.
 *
 * A hash is required, deliberately. Without one this would be an open proxy
 * that fetches whatever a query string names and hands it back from our
 * origin, and "here are some bytes, they are probably three.js" is exactly
 * the thing the declaration model exists to refuse.
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
        (!PATH.test(path) && "path") ||
        (path.includes("..") && "path") ||
        (!HASH.test(hash) && "hash");

    if (bad) {
        return new Response(`Bad ${bad}.`, { status: 400 });
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
