import type { MetadataRoute } from "next";
import { BRAND, NETWORK } from "@/lib/config";

/**
 * What crawlers may read.
 *
 * A testnet deployment is excluded outright. It carries the same routes and
 * the same titles as production, and letting it be indexed means competing
 * with ourselves for every one of them with pages whose contracts do not
 * exist on mainnet.
 *
 * The studio is excluded on every network: a draft lives in one browser's
 * IndexedDB, so those routes render nothing for anyone else and there is
 * nothing there to index.
 */
export default function robots(): MetadataRoute.Robots {
    if (NETWORK !== "mainnet") {
        return { rules: [{ userAgent: "*", disallow: "/" }] };
    }

    return {
        rules: [
            {
                userAgent: "*",
                allow: "/",
                disallow: ["/studio/", "/manage/", "/mine", "/api/", "/offline"],
            },
        ],
        sitemap: `${BRAND.url}/sitemap.xml`,
        host: BRAND.url,
    };
}
