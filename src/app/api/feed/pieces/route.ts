import { type NextRequest, NextResponse } from "next/server";
import { fetchRecentFeed } from "@/lib/feed";
import { isAddress } from "@/lib/tzkt";

/**
 * Edge-cached paginated feed of minted pieces.
 *
 * GET rather than a server action so Netlify's edge CDN caches each page chunk
 * under Cache-Control and serves it without invoking a serverless function.
 */
export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const rawOffset = searchParams.get("offset");
    const rawLimit = searchParams.get("limit");
    const generator = searchParams.get("generator") || undefined;

    if (generator && !isAddress(generator)) {
        return NextResponse.json({ error: "Invalid generator address" }, { status: 400 });
    }

    const offset = Math.max(0, Number.parseInt(rawOffset || "0", 10) || 0);
    const limit = Math.min(48, Math.max(1, Number.parseInt(rawLimit || "24", 10) || 24));

    try {
        const feed = await fetchRecentFeed(limit, offset, generator);
        return NextResponse.json(
            {
                items: feed.pieces,
                cursor: feed.hasMore ? String(offset + feed.pieces.length) : undefined,
                artists: Array.from(feed.artists.entries()),
            },
            {
                headers: {
                    "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
                },
            },
        );
    } catch {
        return NextResponse.json({ error: "Failed to read feed" }, { status: 502 });
    }
}
