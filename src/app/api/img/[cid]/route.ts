import { IPFS_GATEWAYS } from "@/utils/ipfs";

/**
 * Pinned images, served from here instead of from a gateway.
 *
 * Three things this buys, and the first is the reason it exists.
 *
 * **It can be cached forever.** A CID is a hash of the bytes it names, so the
 * answer to a given CID can never change. The first viewer pays one gateway
 * round trip and the CDN in front of this serves everyone after them. Pointing
 * an `<img>` straight at a gateway pays that round trip on every page view,
 * for every visitor, for bytes that were identical the whole time.
 *
 * **No visitor's address reaches a gateway**, the same reason `/api/dep` goes
 * to npm server-side rather than letting the studio do it.
 *
 * **A gateway that is down stops being fatal.** They are tried in order here,
 * where trying again costs nothing, instead of in a browser that has already
 * painted a broken image. A piece is still drawable from chain state if every
 * one of them fails, and the caller falls back to that.
 *
 * The response is opaque bytes with a content type, and nothing about the
 * request is passed on: the CID is validated against a shape, the gateway is
 * ours to choose, and the caller cannot name a host.
 */

export const dynamic = "force-static";
export const revalidate = 31536000;

/** The shape TzKT and our own pinning produce. Anything else is not a CID. */
const CID = /^[A-Za-z0-9]{46,64}$/;

/** An image and nothing else. A gateway serving HTML is a gateway erroring. */
const ALLOWED = /^image\/(png|jpeg|gif|webp|avif|svg\+xml)$/;

/** A render is a PNG of a square. Anything past this is not one of ours. */
const MAX_BYTES = 16 * 1024 * 1024;

const FOREVER = {
    // Immutable is the honest word here: this URL cannot ever mean different
    // bytes, so a browser never needs to revalidate it.
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
            // Short, because these are tried one after another inside a single
            // request that the host will kill at its own limit. A generous
            // timeout per gateway spends the whole budget on the first one and
            // never reaches the rest.
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

    // Deliberately not cached. A gateway that had not pulled the content yet
    // will have it shortly, and caching this for a year would make a
    // propagation delay permanent.
    return new Response("not available", {
        status: 502,
        headers: { "cache-control": "no-store" },
    });
}
