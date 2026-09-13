"use client";

import { FeedGrid } from "@/components/feed/FeedGrid";
import { GeneratorGrid } from "@/components/generator/GeneratorCard";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { FeedPiece } from "@/lib/feed";
import type { GeneratorSummary } from "@/lib/generator";

export function WalletTabs({ made, held }: { made: GeneratorSummary[]; held: FeedPiece[] }) {
    // "Created" leads by default, but only when there's something to show there.
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
                        No generators published from this address.
                    </p>
                ) : (
                    <GeneratorGrid generators={made} />
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
