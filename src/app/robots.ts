import type { MetadataRoute } from "next";
import { BRAND, NETWORK } from "@/lib/config";

/**
 * What crawlers may read. A testnet deployment is excluded outright, since it
 * carries production's routes and titles over contracts that do not exist on
 * mainnet. The studio is excluded on every network: a draft lives in one
 * browser's IndexedDB, so those routes render nothing for anyone else.
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
