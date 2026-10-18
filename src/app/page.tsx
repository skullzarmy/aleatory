import type { Metadata } from "next";
import { fetchLiveCatalog, type GeneratorSummary } from "@/lib/generator";
import { EmptyFeed } from "@/components/feed/EmptyFeed";
import { LiveRefresh } from "@/components/LiveRefresh";
import { LastGood } from "@/components/LastGood";
import { ReadFailed } from "@/components/ReadFailed";
import { SiteJsonLd } from "@/components/JsonLd";
import { GeneratorFeed } from "@/components/generator/GeneratorFeed";
import { BRAND } from "@/lib/config";
import { parseSortKey } from "@/lib/generator-sort";

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

type Query = { sort?: string; soldOut?: string };

export default async function HomePage(props: { searchParams?: Promise<Query> }) {
    let rawSort: string | undefined;
    let hideSoldOut = false;
    try {
        const query = await props.searchParams;
        rawSort = query?.sort;
        hideSoldOut = query?.soldOut === "hide";
    } catch {
        // Query read failed
    }

    const sortKey = parseSortKey(rawSort);

    let catalog: { generators: GeneratorSummary[]; unconfigured: boolean };
    try {
        catalog = await fetchLiveCatalog();
    } catch {
        return <ReadFailed />;
    }
    const generators = catalog.generators;

    if (catalog.unconfigured || generators.length === 0) {
        return (
            <LastGood>
                <div className="mx-auto max-w-7xl px-4 py-8">
                    <LiveRefresh seconds={60} />
                    <EmptyFeed reason={catalog.unconfigured ? "unconfigured" : "no-generators"} />
                </div>
            </LastGood>
        );
    }

    return (
        <LastGood>
            <div className="mx-auto max-w-7xl px-4 py-8">
                <LiveRefresh seconds={60} />
                <SiteJsonLd />
                <GeneratorFeed
                    initial={generators}
                    initialSort={sortKey}
                    initialHideSoldOut={hideSoldOut}
                />
            </div>
        </LastGood>
    );
}
