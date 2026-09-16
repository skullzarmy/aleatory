import type { MetadataRoute } from "next";
import { BRAND } from "@/lib/config";

/** One page. It exists so the crawler is told rather than left to guess. */
export default function sitemap(): MetadataRoute.Sitemap {
    return [{ url: BRAND.url, changeFrequency: "weekly", priority: 1 }];
}
