import { NextResponse } from "next/server";
import { fetchProvider } from "@/lib/providers";

/**
 * Tell the provider a collection names that a piece is waiting.
 *
 * ALEATORY-001 §5: a provider may advertise a push endpoint in its TZIP-016
 * metadata, and that URL is where this goes. The address comes from the
 * collection, and the URL comes from that provider's own contract, so a
 * collection served by somebody else's provider notifies somebody else's
 * provider. An environment variable here could only ever reach ours.
 *
 * Every provider polls the chain regardless, so this shortens a wait and
 * carries no other meaning. A provider that advertises nothing is left alone.
 *
 * A route rather than a call from the browser, because the token is a shared
 * secret: in a browser bundle it would let anyone spend a provider's render
 * budget. The token is per provider, so ours is the only one we can hold, and
 * a third-party endpoint is pinged without one and answers as it likes.
 */
export async function POST(request: Request): Promise<NextResponse> {
    const { provider } = (await request.json().catch(() => ({}))) as { provider?: string };
    if (!provider || !/^KT1[0-9A-Za-z]{33}$/.test(provider)) {
        return NextResponse.json({ pinged: false, why: "no provider named" });
    }

    const known = await fetchProvider(provider).catch(() => null);
    const endpoint = known?.endpoint?.trim();
    if (!endpoint || !/^https:\/\//.test(endpoint)) {
        return NextResponse.json({ pinged: false, why: "no push endpoint advertised" });
    }

    const token =
        provider === process.env.ALEA_PROVIDER_ADDRESS
            ? process.env.ALEA_PROVIDER_PING_TOKEN
            : undefined;

    try {
        await fetch(endpoint, {
            method: "POST",
            headers: token ? { authorization: `Bearer ${token}` } : {},
            signal: AbortSignal.timeout(5_000),
        });
    } catch {
        // The piece is minted and the provider's own poll finds it by the same
        // rule, so there is nothing here worth reporting to a collector.
    }
    return NextResponse.json({ pinged: true });
}
