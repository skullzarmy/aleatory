import { IPFS_GATEWAYS } from "@/utils/ipfs";

/**
 * Pinned images, served from here instead of from a gateway.
 *
 * A CID is a hash of the bytes it names, so a successful answer can be cached
 * forever: the `cache-control` header below does that, not a route-level
 * `force-static`. That segment config caches whatever the handler returns,
 * success or a 502 alike, which pins a propagation delay as the permanent
 * answer for every visitor after the first one who was early. The handler
 * has to run every request; the response headers are what tell a downstream
 * cache which answers are safe to keep.
 *
 * Nothing about the request is passed on: the CID is checked against a shape,
 * the gateway is ours to choose, and the caller cannot name a host.
 */

export const dynamic = "force-dynamic";

/** The shape TzKT and our own pinning produce. Anything else is not a CID. */
const CID = /^[A-Za-z0-9]{46,64}$/;

/**
 * An image and nothing else. A gateway serving HTML is a gateway erroring.
 *
 * No svg+xml: every image this platform pins is rasterized to PNG before
 * pinning, a render's screenshot and a cover's canvas capture alike, so
 * nothing legitimate is ever SVG. It is also the one format here that can
 * carry a script, and the sandboxed CSP below is defense in depth, not a
 * reason to still allow the one format it exists to stop.
 */
const ALLOWED = /^image\/(png|jpeg|gif|webp|avif)$/;

/** A render is a PNG of a square. Anything past this is not one of ours. */
const MAX_BYTES = 16 * 1024 * 1024;

const FOREVER = {
    // This URL cannot mean different bytes, so nothing revalidates it.
    "cache-control": "public, max-age=31536000, immutable",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
};

export async function GET(_request: Request, { params }: { params: Promise<{ cid: string }> }) {
    const { cid } = await params;
    if (!CID.test(cid)) {
        return new Response("not a cid", { status: 400 });
    }

    for (const gateway of IPFS_GATEWAYS) {
        try {
            // Short, because these run one after another inside a single
            // request the host kills at its own limit, and a generous timeout
            // spends the whole budget on the first gateway.
            const res = await fetch(`${gateway}/${cid}`, {
                signal: AbortSignal.timeout(8_000),
            });
            if (!res.ok) continue;

            const type = (res.headers.get("content-type") ?? "").split(";")[0].trim();
            if (!ALLOWED.test(type)) continue;

            const length = Number(res.headers.get("content-length") ?? 0);
            if (length > MAX_BYTES) continue;

            const body = await res.arrayBuffer();
            if (body.byteLength > MAX_BYTES) continue;

            return new Response(body, {
                headers: { ...FOREVER, "content-type": type },
            });
        } catch {
            // The next gateway, or none of them.
        }
    }

    // Not cached: a gateway that has not pulled the content yet will have it
    // shortly, and caching this would make a propagation delay permanent.
    return new Response("not available", {
        status: 502,
        headers: { "cache-control": "no-store" },
    });
}
