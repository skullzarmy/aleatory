import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { fetchGenerator, fetchGeneratorPieces } from "@/lib/generator";
import { fetchListingPage } from "@/lib/market";
import { MintView } from "@/components/generator/MintView";
import { FeedGrid } from "@/components/feed/FeedGrid";
import { shortAddress } from "@/lib/utils";
import { BRAND, tzktLink } from "@/lib/config";
import { coversFor } from "@/lib/feed";
import { AccountLink } from "@/components/account/AccountLink";
import { LiveRefresh } from "@/components/LiveRefresh";
import { GeneratorJsonLd } from "@/components/JsonLd";

/**
 * Rendered per request. `revalidate` here made this a prerendered document, and
 * the refresh below re-fetched that same document rather than the chain.
 */
export const dynamic = "force-dynamic";

type Params = Promise<{ address: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
    const { address } = await params;
    const [c, covers] = await Promise.all([
        fetchGenerator(address).catch(() => null),
        coversFor([address]).catch(() => new Map<string, string>()),
    ]);
    const name = c?.name || shortAddress(address);
    // The generator's newest rendered piece, which is what it looks like.
    const cover = covers.get(address);
    return {
        title: name,
        description: c?.description,
        alternates: { canonical: `/generator/${address}` },
        openGraph: {
            type: "website",
            title: name,
            description: c?.description,
            url: `${BRAND.url}/generator/${address}`,
            images: cover ? [{ url: cover }] : undefined,
        },
        twitter: {
            card: cover ? "summary_large_image" : "summary",
            title: name,
            description: c?.description,
            images: cover ? [cover] : undefined,
        },
    };
}

export default async function GeneratorPage({ params }: { params: Params }) {
    const { address } = await params;
    const [generator, pieces, market] = await Promise.all([
        fetchGenerator(address),
        fetchGeneratorPieces(address),
        // The full list, not just the count: the grid below prices whichever
        // of these pieces are listed. 500 matches the row cap `fetchListingPage`
        // already reads per marketplace, so this never pages.
        fetchListingPage({ generator: address, limit: 500 }).catch(() => ({
            total: 0,
            listings: [],
        })),
    ]);
    if (!generator) return notFound();
    const listed = market.total;
    const prices = new Map(
        market.listings.map((l) => [`${l.generator}:${l.tokenId}`, l.priceMutez] as const),
    );

    return (
        <div className="mx-auto max-w-6xl px-4 py-8">
            <LiveRefresh seconds={30} />
            <GeneratorJsonLd
                name={generator.name || shortAddress(generator.address)}
                description={generator.description}
                creator={generator.artist}
                size={generator.editionSize || undefined}
                url={`${BRAND.url}/generator/${address}`}
            />
            <header className="mb-6">
                {/* The artist's name for it. They typed it, it is on chain, and
                    it is the first thing the page is about. The address is
                    here too, because this is the page somebody checks, but it
                    is not the title. */}
                <h1 className="break-words text-xl font-semibold tracking-tight">
                    {generator.name || shortAddress(generator.address)}
                </h1>

                {/* A row rather than a paragraph with an inline-flex dropped
                    into it: an avatar is taller than the text beside it, so on
                    a text baseline the name sits low and the gap where the
                    picture goes reads as a hole. */}
                <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                    <span>by</span>
                    <AccountLink address={generator.artist} withAvatar />
                    <span aria-hidden>·</span>
                    <a
                        href={tzktLink(generator.address)}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono text-xs hover:text-foreground hover:underline"
                    >
                        {shortAddress(generator.address)}
                    </a>
                </div>
            </header>

            <MintView generator={generator} schema={generator.paramsSchema} />

            {pieces.length > 0 && (
                <div className="mt-12">
                    <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
                        <h2 className="text-lg font-semibold tracking-tight">
                            Pieces ({generator.minted})
                        </h2>
                        {listed > 0 && (
                            <Link
                                href={`/market?generator=${address}`}
                                className="text-sm text-muted-foreground underline hover:text-foreground"
                            >
                                {listed} for sale
                            </Link>
                        )}
                    </div>
                    <FeedGrid pieces={pieces} prices={prices} />
                </div>
            )}
        </div>
    );
}
