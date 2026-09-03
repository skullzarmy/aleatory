import type { MetadataRoute } from "next";
import { BRAND } from "@/lib/config";
import { allFactories } from "@/lib/router";
import { fetchCollections, fetchRecentTokens } from "@/lib/tzkt";
import { isBlockedCollection } from "@/lib/blocklist";

/**
 * Rebuilt hourly, on request, not pinned at build.
 *
 * `revalidate` makes this stale-while-revalidate: the first request after the
 * hour is served the old file and triggers a rebuild, so a collection
 * published five minutes ago is in it within the hour and nobody waits for a
 * chain crawl. No crawler asks more often than that.
 *
 * `force-dynamic` is deliberately not used. It would rebuild this on every
 * request, and every request would then walk the chain.
 */
export const revalidate = 3600;
export const dynamic = "force-static";

/**
 * Every page worth crawling, built from chain state.
 *
 * The static routes are the ones a stranger would want. Collections and pieces
 * come from the chain, because a hand-written list would be stale the moment
 * somebody mints.
 *
 * Bounded on purpose. A sitemap that grows without limit becomes the slowest
 * route on the site, and pieces past the cap are reachable from their
 * collection, which is where a crawler finds them.
 */
const MAX_PIECES = 5_000;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
    const now = new Date();

    const stat: MetadataRoute.Sitemap = (
        [
            [BRAND.url, "hourly", 1],
            [`${BRAND.url}/collections`, "hourly", 0.9],
            [`${BRAND.url}/market`, "hourly", 0.8],
            [`${BRAND.url}/providers`, "weekly", 0.5],
            [`${BRAND.url}/contracts`, "weekly", 0.5],
            [`${BRAND.url}/about`, "monthly", 0.7],
            [`${BRAND.url}/docs/interface`, "monthly", 0.6],
            [`${BRAND.url}/templates`, "monthly", 0.7],
            [`${BRAND.url}/docs/libraries`, "monthly", 0.6],
            [`${BRAND.url}/tezos`, "monthly", 0.6],
            [`${BRAND.url}/terms`, "yearly", 0.3],
            [`${BRAND.url}/terms/privacy`, "yearly", 0.3],
        ] as const
    ).map(([url, changeFrequency, priority]) => ({
        url,
        changeFrequency,
        priority,
        lastModified: now,
    }));

    // A failure here must not take the sitemap with it: a partial sitemap is
    // worth more than a 500.
    //
    // Tokens come from TzKT directly rather than through the feed, which
    // resolves an IPFS document and the pending state for every piece it
    // returns. A sitemap needs a URL and a date; asking the feed for five
    // thousand of them would be thousands of gateway fetches to produce a list
    // of strings, and it would time out long before it finished.
    // One scan of the factories, reused for both lists. Not
    // `fetchAllCollections`, which resolves a name and a cover image for every
    // collection: a cover means reading tokens and then their documents off a
    // gateway, and a sitemap has no use for either.
    const collections = await allFactories()
        .then((f) => Promise.all(f.map((x) => fetchCollections(x).catch(() => []))))
        .then((lists) => {
            const seen = new Set<string>();
            return lists
                .flat()
                .filter((c) => !seen.has(c.address) && (seen.add(c.address), true))
                .filter((c) => !isBlockedCollection(c.address));
        })
        .catch(() => []);

    const tokens = await fetchRecentTokens(
        collections.map((c) => c.address),
        MAX_PIECES,
    ).catch(() => []);

    return [
        ...stat,
        ...collections.map((c) => ({
            url: `${BRAND.url}/collection/${c.address}`,
            lastModified: c.firstActivityTime ? new Date(c.firstActivityTime) : now,
            changeFrequency: "daily" as const,
            priority: 0.8,
        })),
        ...tokens.map((t) => ({
            url: `${BRAND.url}/piece/${t.contract.address}/${t.tokenId}`,
            lastModified: t.firstTime ? new Date(t.firstTime) : now,
            changeFrequency: "weekly" as const,
            priority: 0.7,
        })),
    ];
}
