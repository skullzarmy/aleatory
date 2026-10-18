"use server";

import { fetchGeneratorPage } from "@/lib/generator";
import { fetchRecentFeed, type FeedPiece } from "@/lib/feed";
import type { GeneratorSummary } from "@/lib/generator";
import type { GeneratorSortKey } from "@/lib/generator-sort";

/**
 * The pages after the first, for a grid that loads as it is scrolled.
 *
 * Server actions rather than route handlers: these read exactly what the page
 * that renders the first page reads, through the same cache, so a page
 * fetched on scroll cannot disagree with one rendered on the server.
 *
 * `Map` does not survive the wire, so anything keyed comes back as entries
 * and the caller rebuilds it.
 */

export async function moreGenerators(
    cursor: string,
    sortKey?: GeneratorSortKey,
    hideSoldOut?: boolean,
): Promise<{ items: GeneratorSummary[]; cursor?: string }> {
    const page = await fetchGeneratorPage(20, cursor, sortKey, hideSoldOut);
    return { items: page.generators, cursor: page.cursor };
}

export async function morePieces(
    cursor: string,
    generator?: string,
): Promise<{ items: FeedPiece[]; cursor?: string; artists: [string, string[]][] }> {
    // The cursor is the offset reached so far. A mint feed only grows at the
    // head, so a row cannot move between pages the way a filtered catalog's
    // can, and an offset stays honest.
    const offset = Number.parseInt(cursor, 10) || 0;
    const feed = await fetchRecentFeed(24, offset, generator);
    return {
        items: feed.pieces,
        cursor: feed.hasMore ? String(offset + feed.pieces.length) : undefined,
        artists: Array.from(feed.artists.entries()),
    };
}
