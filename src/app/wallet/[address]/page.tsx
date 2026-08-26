import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FeedGrid } from "@/components/feed/FeedGrid";
import { fetchWallet } from "@/lib/feed";
import { isAddress } from "@/lib/tzkt";
import { tzktLink } from "@/lib/config";
import { shortAddress } from "@/lib/utils";

export const revalidate = 60;

export async function generateMetadata({
    params,
}: {
    params: Promise<{ address: string }>;
}): Promise<Metadata> {
    const { address } = await params;
    return { title: shortAddress(address) };
}

/**
 * One address, both ways round.
 *
 * Everything here is public chain state keyed by an address, so this page needs
 * no account, no connection and no permission: a collector can send someone the
 * link to what they hold, and an artist's page exists from the moment they
 * deploy rather than when they get round to filling in a profile.
 */
export default async function WalletPage({
    params,
}: {
    params: Promise<{ address: string }>;
}) {
    const { address } = await params;
    if (!isAddress(address)) notFound();

    const { held, made, unconfigured } = await fetchWallet(address);

    return (
        <div className="mx-auto max-w-7xl px-4 py-8">
            <header>
                <h1 className="text-xl font-semibold tracking-tight">{shortAddress(address)}</h1>
                <p className="mt-1 text-xs text-muted-foreground">
                    <a
                        href={tzktLink(address)}
                        target="_blank"
                        rel="noreferrer"
                        className="underline hover:text-foreground"
                    >
                        {address}
                    </a>
                </p>
            </header>

            {unconfigured ? (
                <p className="mt-8 text-sm text-muted-foreground">
                    Nothing to show on this network yet.
                </p>
            ) : (
                <>
                    {made.length > 0 && (
                        <section className="mt-8">
                            <h2 className="mb-3 text-sm font-medium">
                                Made {made.length === 1 ? "one collection" : `${made.length} collections`}
                            </h2>
                            <ul className="divide-y divide-border rounded-lg border border-border">
                                {made.map((c) => (
                                    <li key={c.address}>
                                        <Link
                                            href={`/collection/${c.address}`}
                                            className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-accent"
                                        >
                                            <span className="min-w-0 truncate text-sm font-medium">
                                                {c.name || shortAddress(c.address)}
                                            </span>
                                            <span className="shrink-0 text-xs text-muted-foreground">
                                                {c.minted} minted
                                            </span>
                                        </Link>
                                    </li>
                                ))}
                            </ul>
                        </section>
                    )}

                    <section className="mt-10">
                        <h2 className="mb-3 text-sm font-medium">
                            {held.length === 0
                                ? "Holds nothing yet"
                                : `Holds ${held.length === 1 ? "one piece" : `${held.length} pieces`}`}
                        </h2>
                        {held.length === 0 ? (
                            <p className="text-sm text-muted-foreground">
                                Pieces bought here show up on this page.
                            </p>
                        ) : (
                            <FeedGrid pieces={held} />
                        )}
                    </section>
                </>
            )}
        </div>
    );
}
