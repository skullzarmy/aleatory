import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { fetchGenerator, fetchGeneratorPieces } from "@/lib/generator";
import { fetchListingPage } from "@/lib/market";
import { MintView } from "@/components/generator/MintView";
import { GeneratorPieces } from "@/components/generator/GeneratorPieces";
import { shortAddress } from "@/lib/utils";
import { fetchProfile, socialHandle } from "@/lib/identity";
import { BRAND, siteUrl, tzktLink } from "@/lib/config";
import { coversFor } from "@/lib/feed";
import { AccountLink } from "@/components/account/AccountLink";
import { LiveRefresh } from "@/components/LiveRefresh";
import { LastGood } from "@/components/LastGood";
import { ReadFailed } from "@/components/ReadFailed";
import { GeneratorJsonLd } from "@/components/JsonLd";
import { isAddress } from "@/lib/tzkt";
import { unconfirmedCount } from "@/lib/collab";
import { CollektGalleryModal } from "@/components/gallery/CollektGalleryModal";

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
    const description =
        c?.description ||
        `Mint a piece from ${name}, a generator on ${BRAND.name}: fully on-chain generative art on Tezos.`;
    return {
        title: name,
        description,
        alternates: { canonical: `/generator/${address}` },
        openGraph: {
            type: "website",
            title: name,
            description,
            url: `${siteUrl()}/generator/${address}`,
            images: cover ? [{ url: cover }] : undefined,
        },
        twitter: {
            card: cover ? "summary_large_image" : "summary",
            title: name,
            description,
            images: cover ? [cover] : undefined,
        },
    };
}

export default async function GeneratorPage({ params }: { params: Params }) {
    const { address } = await params;
    if (!isAddress(address)) notFound();
    let read;
    try {
        read = await Promise.all([
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
    } catch {
        return <ReadFailed />;
    }
    const [generator, pieces, market] = read;
    if (!generator) return notFound();
    const listed = market.total;
    const prices = new Map(
        market.listings.map((l) => [`${l.generator}:${l.tokenId}`, l.priceMutez] as const),
    );
    const credited = generator.collab.confirmed;
    // Named but not yet confirmed. Counted, never listed: a name shown here
    // before its owner agreed is the thing `accept_collaboration` exists to
    // prevent.
    const unconfirmed = unconfirmedCount(generator.collab);
    const artists = new Map([[generator.address, credited]]);
    // Handles for everyone credited, so a share post tags the collaboration
    // and not just whoever deployed it.
    const artistHandles = await Promise.all(
        credited.map(async (a) => {
            const profile = await fetchProfile(a).catch(() => null);
            return {
                address: a,
                twitter: socialHandle(profile, "twitter") ?? undefined,
                bluesky: socialHandle(profile, "bluesky") ?? undefined,
                farcaster: socialHandle(profile, "farcaster") ?? undefined,
                telegram: socialHandle(profile, "telegram") ?? undefined,
            };
        }),
    );

    return (
        <LastGood>
            <div className="mx-auto max-w-6xl px-4 py-8">
                <LiveRefresh seconds={30} />
                <GeneratorJsonLd
                    name={generator.name || shortAddress(generator.address)}
                    description={generator.description}
                    creators={credited}
                    size={generator.editionSize || undefined}
                    url={`${siteUrl()}/generator/${address}`}
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
                        {credited.map((a, i) => (
                            <span key={a} className="inline-flex items-center gap-x-2">
                                {i > 0 && <span aria-hidden>and</span>}
                                <AccountLink address={a} withAvatar />
                            </span>
                        ))}
                        {unconfirmed > 0 && (
                            <span>
                                {`and ${unconfirmed} awaiting ${
                                    unconfirmed === 1 ? "credit" : "credits"
                                }`}
                            </span>
                        )}
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

                <MintView
                    generator={generator}
                    schema={generator.paramsSchema}
                    coverUrl={
                        generator.coverUrl ?? pieces.find((p) => !p.pending && p.imageUrl)?.imageUrl
                    }
                    shareUrl={`${siteUrl()}/generator/${address}`}
                    shareText={generator.name || shortAddress(generator.address)}
                    artistHandles={artistHandles}
                />

                {pieces.length > 0 && (
                    <div className="mt-12">
                        <div className="mb-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
                            <div className="flex items-center gap-3">
                                <h2 className="text-lg font-semibold tracking-tight">
                                    Pieces ({generator.minted})
                                </h2>
                                <CollektGalleryModal
                                    generatorAddress={generator.address}
                                    generatorName={
                                        generator.name || shortAddress(generator.address)
                                    }
                                />
                            </div>
                            {listed > 0 && (
                                <Link
                                    href={`/market?generator=${address}`}
                                    className="text-sm text-muted-foreground underline hover:text-foreground"
                                >
                                    {listed} for sale
                                </Link>
                            )}
                        </div>
                        <GeneratorPieces
                            pieces={pieces}
                            artists={Array.from(artists.entries())}
                            prices={Array.from(prices.entries()).map(([k, v]) => [k, v.toString()])}
                        />
                    </div>
                )}
            </div>
        </LastGood>
    );
}
