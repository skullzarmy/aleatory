import { NextResponse } from "next/server";

/**
 * Nudge the render provider after a mint.
 *
 * The provider polls on a cron regardless, so this only turns a five minute
 * wait into a few seconds. It exists as a route rather than a direct call
 * because the provider's shared secret has to stay server side: a token in a
 * browser bundle would let anyone spend our render budget.
 *
 * Failing here is harmless. The piece is already minted and the next cron
 * finds it by the same rule.
 */
export async function POST(): Promise<NextResponse> {
    const url = process.env.ALEA_PROVIDER_URL;
    const token = process.env.ALEA_PROVIDER_PING_TOKEN;
    if (!url || !token) {
        return NextResponse.json({ pinged: false });
    }

    try {
        await fetch(url, {
            method: "POST",
            headers: { authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(5_000),
        });
    } catch {
        /* the cron covers it */
    }
    return NextResponse.json({ pinged: true });
}
