import Link from "next/link";
import type { Metadata } from "next";
import { fetchListings } from "@/lib/market";
import { addresses } from "@/lib/router";
import { formatTez, shortAddress } from "@/lib/utils";
import { AccountLink } from "@/components/account/AccountLink";

export const metadata: Metadata = { title: "Market" };
export const revalidate = 15;

export default async function MarketPage() {
    const marketplace = (await addresses()).marketplace;
    const listings = await fetchListings().catch(() => []);

    return (
        <div className="mx-auto max-w-7xl px-4 py-8">
            <div className="mb-6 flex items-baseline justify-between">
                <h1 className="text-xl font-semibold tracking-tight">Market</h1>
                <p className="text-sm text-muted-foreground">
                    2.5% of each sale, royalties paid from the collection
                </p>
            </div>

            {listings.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border px-6 py-16 text-center">
                    <h2 className="text-base font-medium">Nothing listed</h2>
                    <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                        {marketplace
                            ? "Pieces listed for sale show up here."
                            : "The marketplace is waiting to be deployed."}
                    </p>
                </div>
            ) : (
                <ul className="divide-y divide-border rounded-lg border border-border">
                    {listings.map((l) => (
                        <li key={l.id}>
                            <Link
                                href={`/piece/${l.collection}/${l.tokenId}`}
                                className="flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-accent"
                            >
                                <span className="min-w-0">
                                    <span className="block truncate font-medium">
                                        #{Number(l.tokenId) + 1}
                                    </span>
                                    <span className="block truncate text-xs text-muted-foreground">
                                        {shortAddress(l.collection)} by <AccountLink address={l.seller} />
                                    </span>
                                </span>
                                <span className="shrink-0 font-medium">
                                    {formatTez(l.priceMutez)} ꜩ
                                </span>
                            </Link>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
