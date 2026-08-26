"use client";

import Link from "next/link";
import { FeedGrid } from "@/components/feed/FeedGrid";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { shortAddress } from "@/lib/utils";
import type { FeedPiece } from "@/lib/feed";

/**
 * The two things an address is: someone who made work, and someone who holds it.
 *
 * Created leads. On a site about generative art the work someone published is
 * the reason to be on their page at all, and a collection of forty pieces they
 * bought pushed it off the screen.
 *
 * It only leads when there is something there, though. Defaulting to an empty
 * panel to honour an ordering rule is the ordering rule beating the reader.
 */
export function WalletTabs({
    made,
    held,
}: {
    made: { address: string; name?: string; minted: number }[];
    held: FeedPiece[];
}) {
    const first = made.length > 0 ? "created" : "collected";

    return (
        <Tabs defaultValue={first} className="mt-8">
            <TabsList>
                <TabsTrigger value="created">
                    Created
                    <Count n={made.length} />
                </TabsTrigger>
                <TabsTrigger value="collected">
                    Collected
                    <Count n={held.length} />
                </TabsTrigger>
            </TabsList>

            <TabsContent value="created">
                {made.length === 0 ? (
                    <p className="py-6 text-sm text-muted-foreground">
                        No collections published from this address.
                    </p>
                ) : (
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
                )}
            </TabsContent>

            <TabsContent value="collected">
                {held.length === 0 ? (
                    <p className="py-6 text-sm text-muted-foreground">
                        Pieces bought here show up on this page.
                    </p>
                ) : (
                    <FeedGrid pieces={held} />
                )}
            </TabsContent>
        </Tabs>
    );
}

function Count({ n }: { n: number }) {
    return (
        <span className="rounded-full bg-muted px-1.5 text-xs font-normal tabular-nums text-muted-foreground">
            {n}
        </span>
    );
}
