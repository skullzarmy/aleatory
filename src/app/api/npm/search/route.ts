import { search } from "@/lib/npm";

/**
 * npm's search, from our origin.
 *
 * The browser cannot ask npm itself. `connect-src` is `'self'` plus a short
 * list of named hosts, and widening it to the registry would put every
 * visitor's IP in front of npm and make the privacy policy wrong, which is the
 * same reason `/api/dep` exists.
 *
 * A search result is not about the person who asked for it, so the answer is
 * cached hard and shared. Nothing here is logged and nothing about the caller
 * is forwarded.
 *
 * No `revalidate` export. This reads the query string, so it is dynamic
 * whatever that said, and the caching that actually happens is the header on
 * the way out.
 */
export async function GET(request: Request) {
    const text = (new URL(request.url).searchParams.get("q") ?? "").trim();

    // Long enough to mean something. A single letter is a full table scan of
    // npm on somebody else's machine, answered on every keystroke.
    if (text.length < 2) {
        return Response.json({ hits: [] });
    }
    if (text.length > 100) {
        return new Response("Query too long.", { status: 400 });
    }

    try {
        return Response.json(
            { hits: await search(text) },
            {
                headers: {
                    "cache-control":
                        "public, max-age=600, s-maxage=3600, stale-while-revalidate=86400",
                },
            },
        );
    } catch {
        return new Response("npm did not answer.", { status: 502 });
    }
}
