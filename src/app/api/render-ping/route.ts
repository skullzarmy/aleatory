import { NextResponse } from "next/server";
import { fetchProvider } from "@/lib/providers";

/**
 * Tell the provider a collection names that a piece is waiting.
 *
 * ALEATORY-001 §5: a provider may advertise a push endpoint in its TZIP-016
 * metadata, and that URL is where this goes. The address comes from the
 * collection and the URL from that provider's own contract, so a collection
 * served by somebody else's provider notifies somebody else's provider. An
 * environment variable here could only ever reach ours.
 *
 * Every provider polls the chain regardless, so this shortens a wait and
 * carries no other meaning.
 *
 * **The destination is chosen by a stranger.** Anyone can originate a contract
 * whose metadata names any URL, this route is unauthenticated, and it is a
 * server making the request, so without the checks below it is a machine that
 * fetches whatever it is told to. That is the whole threat here: the response
 * is discarded, no body is sent, and the token below never travels to an
 * address that is not ours.
 *
 * A route rather than a call from the browser, because the token is a shared
 * secret: in a browser bundle it would let anyone spend a provider's render
 * budget.
 */

/** Hosts that only ever mean "somewhere inside the network this runs on". */
const PRIVATE_HOST =
    /^(localhost$|.*\.local$|.*\.internal$|.*\.localhost$|\[|(\d{1,3}\.){3}\d{1,3}$)/i;

/**
 * A URL worth sending a stranger's request to.
 *
 * https only, a named host, and no address literal. Cloud metadata services
 * and everything on a private network are reached by literal or by a
 * loopback name, so refusing both covers the cases that matter without
 * resolving DNS on the request path.
 */
function reachable(raw: string): URL | null {
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        return null;
    }
    if (url.protocol !== "https:") return null;
    // Credentials in the URL become a Basic header on a request we make on
    // somebody else's say-so, and a push endpoint has no use for them.
    if (url.username || url.password) return null;
    if (PRIVATE_HOST.test(url.hostname)) return null;
    // A host with no dot is a bare name, resolvable only on the local network.
    if (!url.hostname.includes(".")) return null;
    return url;
}

/** One in flight at a time, so this cannot be used to generate volume. */
let lastAt = 0;
const MIN_GAP_MS = 250;

export async function POST(request: Request): Promise<NextResponse> {
    const now = Date.now();
    if (now - lastAt < MIN_GAP_MS) {
        return NextResponse.json({ pinged: false, why: "too many" }, { status: 429 });
    }
    lastAt = now;

    const { provider } = (await request.json().catch(() => ({}))) as { provider?: string };
    if (!provider || !/^KT1[0-9A-Za-z]{33}$/.test(provider)) {
        return NextResponse.json({ pinged: false, why: "no provider named" });
    }

    const known = await fetchProvider(provider).catch(() => null);
    const endpoint = reachable(known?.endpoint?.trim() ?? "");
    if (!endpoint) {
        return NextResponse.json({ pinged: false, why: "no usable push endpoint" });
    }

    // Ours is the only provider we hold a token for, and it is the only one it
    // is ever sent to. A planted endpoint cannot collect it.
    const token =
        provider === process.env.ALEA_PROVIDER_ADDRESS
            ? process.env.ALEA_PROVIDER_PING_TOKEN
            : undefined;

    try {
        await fetch(endpoint, {
            method: "POST",
            headers: token ? { authorization: `Bearer ${token}` } : {},
            // A redirect is a second destination this route never checked, and
            // is how an allowed host hands the request to a forbidden one.
            redirect: "manual",
            signal: AbortSignal.timeout(5_000),
        });
    } catch {
        // The piece is minted and the provider's own poll finds it by the same
        // rule, so there is nothing here worth reporting to a collector.
    }
    return NextResponse.json({ pinged: true });
}
