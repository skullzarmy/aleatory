import type { Metadata } from "next";
import { fetchGeneratorPage, type GeneratorPage } from "@/lib/generator";
import { EmptyFeed } from "@/components/feed/EmptyFeed";
import { LiveRefresh } from "@/components/LiveRefresh";
import { LastGood } from "@/components/LastGood";
import { ReadFailed } from "@/components/ReadFailed";
import { SiteJsonLd } from "@/components/JsonLd";
import { GeneratorFeed } from "@/components/generator/GeneratorFeed";
import { BRAND } from "@/lib/config";

const HOME_DESCRIPTION =
    "Browse every generator live on Aleatory, fully on-chain generative art on Tezos, and mint a one-of-a-kind piece from the artist's code.";

export const metadata: Metadata = {
    // The root layout's title is a template; `absolute` opts the home page out of it.
    title: { absolute: `${BRAND.name} — ${BRAND.tagline}` },
    description: HOME_DESCRIPTION,
    alternates: { canonical: "/" },
    openGraph: {
        type: "website",
        url: BRAND.url,
        title: `${BRAND.name} — ${BRAND.tagline}`,
        description: HOME_DESCRIPTION,
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
    // The first page only. The rest arrive as the reader scrolls, because
    // resolving every generator's name, artist and state on one request is
    // what an indexer starts refusing once the catalog is large.
    let page: GeneratorPage;
    try {
        page = await fetchGeneratorPage(20);
    } catch {
        return <ReadFailed />;
    }
    const generators = page.generators;

    if (generators.length === 0) {
        return (
            <LastGood>
                <div className="mx-auto max-w-7xl px-4 py-8">
                    <LiveRefresh seconds={60} />
                    <EmptyFeed reason={page.unconfigured ? "unconfigured" : "no-generators"} />
                </div>
            </LastGood>
        );
    }

    return (
        <LastGood>
            <div className="mx-auto max-w-7xl px-4 py-8">
                <LiveRefresh seconds={60} />
                <SiteJsonLd />
                <div className="mb-6 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
                    <h1 className="text-xl font-semibold tracking-tight">Generators</h1>
                    <p className="text-sm text-muted-foreground">
                        Every generator on {BRAND.name}, newest first
                    </p>
                </div>

                <GeneratorFeed initial={generators} cursor={page.cursor} />
            </div>
        </LastGood>
    );
}
