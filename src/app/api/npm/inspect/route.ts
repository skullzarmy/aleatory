import { ID, OutOfTime, VERSION, resolve } from "@/lib/npm";

/**
 * One package, turned into something declarable.
 *
 * Whether a script tag can load it, what it puts on `window`, how large it is,
 * and what to declare instead when the version asked for will not do: another
 * file in the same version, or the newest version that still ships a global
 * build. Read from jsDelivr's listings and the builds themselves. Nothing is
 * executed: see the note at the top of `lib/npm.ts`.
 *
 * One call answers the whole question, because the alternative is a client that
 * has to know the fallback order and three round trips to walk it.
 *
 * No `revalidate` export. This reads the query string, so it is dynamic
 * whatever that said, and the caching that actually happens is the header
 * below. A pinned version cannot change what it is, so the answer is immutable.
 */
export async function GET(request: Request) {
    const q = new URL(request.url).searchParams;
    const id = q.get("id") ?? "";
    const version = q.get("version") ?? "";

    const bad = (!ID.test(id) && "id") || (!VERSION.test(version) && "version");
    if (bad) return new Response(`Bad ${bad}.`, { status: 400 });

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
                { status: 504, headers: { "cache-control": "no-store" } },
            );
        }
        return new Response(e instanceof Error ? e.message : "Could not read that package.", {
            status: 502,
            headers: { "cache-control": "no-store" },
        });
    }
}
