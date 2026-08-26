import { NextResponse } from "next/server";
import { blake2bHex } from "blakejs";
import { RUNTIME_KINDS, type DepSpec } from "@/lib/runtimes";

/**
 * Shared libraries, fetched through our own origin.
 *
 * The studio inlines a library into a piece's document before it runs, which
 * means the browser has to obtain it somehow. Fetching the CDN directly from
 * the app origin would mean widening that origin's `connect-src` to a host we
 * do not control, on the page that holds wallet session state. So it comes
 * through here instead and the app keeps `connect-src 'self'`.
 *
 * The second reason is better: the digest is checked *here*. A check that runs
 * in the page is a check that a compromised page skips, and the whole point of
 * pinning a dependency by hash is that nobody gets to decide to skip it.
 *
 * The set of fetchable URLs is closed. A caller names a declared dependency by
 * id and version, and anything else is refused, so this is not an open proxy.
 */

const ALLOWED: DepSpec[] = RUNTIME_KINDS.flatMap((k) => k.deps);

const MAX_BYTES = 4_000_000;
const TIMEOUT_MS = 15_000;

export async function GET(request: Request) {
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    const version = url.searchParams.get("version");

    const spec = ALLOWED.find((d) => d.id === id && (!version || d.version === version));
    if (!spec) {
        return NextResponse.json(
            { error: "Not a declared dependency." },
            { status: 404 },
        );
    }

    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
        const res = await fetch(spec.url, { signal: controller.signal }).finally(() =>
            clearTimeout(timer),
        );
        if (!res.ok) {
            return NextResponse.json(
                { error: `${spec.label} ${spec.version} could not be fetched (${res.status}).` },
                { status: 502 },
            );
        }

        const source = await res.text();
        const bytes = new TextEncoder().encode(source);
        if (bytes.length > MAX_BYTES) {
            return NextResponse.json({ error: "Dependency too large." }, { status: 502 });
        }

        const hash = blake2bHex(bytes, undefined, 32);
        if (spec.expectedHash && hash !== spec.expectedHash) {
            // Refuse rather than warn. A republished or compromised CDN is
            // exactly the case this exists for, and the artist's chain record
            // would otherwise vouch for whatever came back.
            console.error(`dep ${spec.id}@${spec.version} hash mismatch: ${hash}`);
            return NextResponse.json(
                {
                    error: `${spec.label} ${spec.version} does not match its pinned hash. Refusing to use it.`,
                },
                { status: 502 },
            );
        }

        return NextResponse.json(
            { source, hash, bytes: bytes.length, pinned: Boolean(spec.expectedHash) },
            {
                headers: {
                    // Immutable by version. The hash check above is what makes
                    // caching it safe.
                    "cache-control": "public, max-age=3600, stale-while-revalidate=86400",
                },
            },
        );
    } catch (e) {
        console.error("dep fetch failed", e);
        return NextResponse.json({ error: "Dependency fetch failed." }, { status: 502 });
    }
}
