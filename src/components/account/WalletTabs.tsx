"use client";

import { FeedGrid } from "@/components/feed/FeedGrid";
import { CollectionGrid } from "@/components/collection/CollectionCard";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { FeedPiece } from "@/lib/feed";
import type { CollectionSummary } from "@/lib/collection";

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
export function WalletTabs({ made, held }: { made: CollectionSummary[]; held: FeedPiece[] }) {
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
                    <CollectionGrid collections={made} />
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
