import type { MetadataRoute } from "next";
import { BRAND } from "@/lib/config";
import { allFactories } from "@/lib/router";
import { fetchGenerators, fetchRecentTokens } from "@/lib/tzkt";
import { isBlockedGenerator } from "@/lib/blocklist";

/**
 * Rebuilt hourly, on request. `revalidate` is stale-while-revalidate: the first
 * request after the hour is served the old file and triggers a rebuild, so
 * nobody waits for a chain crawl. `force-dynamic` would walk the chain on every
 * request.
 */
export const revalidate = 3600;
export const dynamic = "force-static";

/**
 * The cap on pieces. Past it they are still reachable from their generator,
 * which is where a crawler finds them.
 */
const MAX_PIECES = 5_000;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
    const now = new Date();

    const stat: MetadataRoute.Sitemap = (
        [
            [BRAND.url, "hourly", 1],
            [`${BRAND.url}/mints`, "hourly", 0.9],
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

    // A partial sitemap is worth more than a 500, so every read degrades to
    // empty.
    //
    // Straight from TzKT, not through the feed or `fetchAllGenerators`: both
    // resolve an IPFS document per piece, which for five thousand of them is
    // thousands of gateway fetches to produce a list of URLs and dates.
    const generators = await allFactories()
        .then((f) => Promise.all(f.map((x) => fetchGenerators(x).catch(() => []))))
        .then((lists) => {
            const seen = new Set<string>();
            return lists
                .flat()
                .filter((c) => !seen.has(c.address) && (seen.add(c.address), true))
                .filter((c) => !isBlockedGenerator(c.address));
        })
        .catch(() => []);

    const tokens = await fetchRecentTokens(
        generators.map((c) => c.address),
        MAX_PIECES,
    ).catch(() => []);

    return [
        ...stat,
        ...generators.map((c) => ({
            url: `${BRAND.url}/generator/${c.address}`,
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
