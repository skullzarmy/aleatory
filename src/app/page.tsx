import type { Metadata } from "next";
import { fetchAllGenerators } from "@/lib/generator";
import { EmptyFeed } from "@/components/feed/EmptyFeed";
import { LiveRefresh } from "@/components/LiveRefresh";
import { SiteJsonLd } from "@/components/JsonLd";
import { GeneratorGrid } from "@/components/generator/GeneratorCard";
import { BRAND } from "@/lib/config";

export const metadata: Metadata = {
    // The root layout's title is a template; `absolute` opts the home page out of it.
    title: { absolute: `${BRAND.name} — ${BRAND.tagline}` },
    description: BRAND.description,
    alternates: { canonical: "/" },
    openGraph: {
        type: "website",
        url: BRAND.url,
        title: `${BRAND.name} — ${BRAND.tagline}`,
        description: BRAND.description,
    },
};
/**
 * Rendered per request, not prerendered on a timer. With `revalidate` this page
 * was a CDN document, and `router.refresh()` re-fetched that same document:
 * the timer below fired all day against a copy that was minutes old, so a
 * generator published now did not appear until somebody reloaded by hand.
 */
export const dynamic = "force-dynamic";

// TzKT's alias is set only for contracts it recognizes, never ours, so the display
// name comes from the generator's own metadata instead.
export default async function HomePage() {
    const generators = await fetchAllGenerators();

    if (generators.length === 0) {
        return (
            <div className="mx-auto max-w-7xl px-4 py-8">
                <LiveRefresh seconds={60} />
                <EmptyFeed reason="unconfigured" />
            </div>
        );
    }

    return (
        <div className="mx-auto max-w-7xl px-4 py-8">
            <LiveRefresh seconds={60} />
            <SiteJsonLd />
            <div className="mb-6 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
                <h1 className="text-xl font-semibold tracking-tight">Generators</h1>
                <p className="text-sm text-muted-foreground">
                    Every generator on {BRAND.name}, newest first
                </p>
            </div>

            <GeneratorGrid generators={generators} />
        </div>
    );
}
