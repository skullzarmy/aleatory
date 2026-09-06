import { NextResponse } from "next/server";
import { isIP } from "node:net";
import { fetchProvider } from "@/lib/providers";

/**
 * Tell the provider a collection names that a piece is waiting.
 *
 * ALEATORY-001 §5: a provider may advertise a push endpoint in its TZIP-016
 * metadata. The address comes from the collection and the URL from that
 * provider's own contract, so somebody else's provider gets notified for
 * somebody else's collection. Every provider polls regardless, so this only
 * shortens a wait.
 *
 * The destination is chosen by a stranger: anyone can originate a contract
 * whose metadata names any URL, and this route is unauthenticated, so without
 * the checks below it is a server that fetches whatever it is told to. Nothing
 * is sent with the request and the response is discarded.
 *
 * A route rather than a call from the browser, so those checks run out of reach
 * of whoever is minting.
 */

/** Hosts that only ever mean "somewhere inside the network this runs on". */
const PRIVATE_HOST =
    /^(localhost$|.*\.local$|.*\.internal$|.*\.localhost$|\[|(\d{1,3}\.){3}\d{1,3}$)/i;

/**
 * A URL worth sending a stranger's request to: https, a named host, no address
 * literal. Cloud metadata services and private networks are reached by literal
 * or by a loopback name, so refusing both covers them without resolving DNS.
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

/**
 * A gap between calls, per running instance, so it slows a hammer without
 * bounding one. What limits the damage is that the request is 1:1 with no body,
 * to a destination published on chain by a contract somebody paid to originate.
 */
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

    try {
        await fetch(endpoint, {
            method: "POST",
            // A redirect is a second destination this route never checked, and
            // is how an allowed host hands the request to a forbidden one.
            redirect: "manual",
            signal: AbortSignal.timeout(5_000),
        });
    } catch {
        // The provider's own poll finds the piece by the same rule.
    }
    return NextResponse.json({ pinged: true });
}
