import Link from "next/link";
import { FeedGrid } from "@/components/feed/FeedGrid";
import { GeneratorGrid } from "@/components/generator/GeneratorCard";
import { Pager } from "@/components/feed/Pager";
import type { WalletView } from "@/lib/feed";

export function WalletTabs({
    wallet,
    tab,
    page,
    href,
}: {
    wallet: WalletView;
    tab: "created" | "collected";
    page: number;
    href: (next: { tab?: "created" | "collected"; page?: number }) => string;
}) {
    const { made, madeCount, madePages, held, heldCount, heldPages } = wallet;

    return (
        <div className="mt-8">
            <div className="inline-flex h-10 items-center justify-center gap-1 rounded-md bg-muted p-1 text-muted-foreground">
                <TabLink
                    label="Created"
                    count={madeCount}
                    active={tab === "created"}
                    href={href({ tab: "created", page: 1 })}
                />
                <TabLink
                    label="Collected"
                    count={heldCount}
                    active={tab === "collected"}
                    href={href({ tab: "collected", page: 1 })}
                />
            </div>

            <div className="mt-4">
                {tab === "created" ? (
                    made.length === 0 ? (
                        <p className="py-6 text-sm text-muted-foreground">
                            No generators published from this address.
                        </p>
                    ) : (
                        <>
                            <GeneratorGrid generators={made} />
                            <Pager
                                page={page}
                                hasMore={page < madePages}
                                href={(p) => href({ page: p })}
                                showing={`Page ${page} of ${madePages}`}
                            />
                        </>
                    )
                ) : held.length === 0 ? (
                    <p className="py-6 text-sm text-muted-foreground">
                        Pieces bought here show up on this page.
                    </p>
                ) : (
                    <>
                        <FeedGrid pieces={held} />
                        <Pager
                            page={page}
                            hasMore={page < heldPages}
                            href={(p) => href({ page: p })}
                            showing={`Page ${page} of ${heldPages}`}
                        />
                    </>
                )}
            </div>
        </div>
    );
}

function TabLink({
    label,
    count,
    active,
    href,
}: {
    label: string;
    count: number;
    active: boolean;
    href: string;
}) {
    return (
        <Link
            href={href}
            className={`inline-flex items-center gap-2 rounded-sm px-3 py-1.5 text-sm font-medium ${
                active ? "bg-background text-foreground shadow-sm" : ""
            }`}
        >
            {label}
            <span className="rounded-full bg-muted px-1.5 text-xs font-normal tabular-nums text-muted-foreground">
                {count}
            </span>
        </Link>
    );
}
