import { ID, OutOfTime, VERSION, resolve } from "@/lib/npm";

/**
 * One package, turned into something declarable: whether a script tag can load
 * it, what it puts on `window`, how large it is, and what to declare instead
 * when the version asked for will not do. Read from jsDelivr's listings and the
 * builds themselves, and nothing is executed.
 *
 * One call answers the whole question, so a client needs no knowledge of the
 * fallback order.
 *
 * No `revalidate` export: this reads the query string, so it is dynamic, and
 * the header below is the caching that happens. A pinned version cannot change
 * what it is, so the answer is immutable.
 */
export async function GET(request: Request) {
    const q = new URL(request.url).searchParams;
    const id = q.get("id") ?? "";
    const version = q.get("version") ?? "";

    // Labelled, so the client can tell this route's own words from an error
    // page written by whatever sits in front of it.
    const plain = { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" };

    const bad = (!ID.test(id) && "id") || (!VERSION.test(version) && "version");
    if (bad) return new Response(`Bad ${bad}.`, { status: 400, headers: plain });

    try {
        return Response.json(await resolve(id, version), {
            headers: { "cache-control": "public, max-age=31536000, immutable" },
        });
    } catch (e) {
        // Giving up on the clock is not a verdict on the package, and must not
        // be cached as one. 504 so the client can offer to try again.
        if (e instanceof OutOfTime) {
            return new Response(
                `Checking ${id}@${version} took too long. It may answer on a second try.`,
                { status: 504, headers: plain },
            );
        }
        return new Response(e instanceof Error ? e.message : "Could not read that package.", {
            status: 502,
            headers: plain,
        });
    }
}
