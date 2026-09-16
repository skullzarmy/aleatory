import type { MetadataRoute } from "next";
import { BRAND } from "@/lib/config";

/**
 * One page, and every crawler is welcome on it. This is the address artists are
 * being sent to, so it should be the one that comes back when somebody searches
 * for us.
 */
export default function robots(): MetadataRoute.Robots {
    return {
        rules: { userAgent: "*", allow: "/" },
        sitemap: `${BRAND.url}/sitemap.xml`,
    };
}
