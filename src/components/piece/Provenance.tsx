import { AccountLink } from "@/components/account/AccountLink";
import { TimeAgo } from "@/components/TimeAgo";
import { formatTez } from "@/lib/utils";
import type { ProvenanceEvent } from "@/lib/provenance";

const LABEL: Record<ProvenanceEvent["kind"], string> = {
    minted: "Minted",
    listed: "Listed",
    cancelled: "Listing cancelled",
    sold: "Sold",
    transferred: "Transferred",
};

/** Mint to current holder, most recent first. */
export function Provenance({ events }: { events: ProvenanceEvent[] }) {
    if (events.length === 0) return null;

    return (
        <div>
            <p className="pb-2 text-sm text-muted-foreground">History</p>
            <ul className="divide-y divide-border rounded-lg border border-border">
                {events.map((e) => (
                    <li
                        key={e.id}
                        className="flex items-start justify-between gap-4 px-4 py-3 text-sm"
                    >
                        <div className="min-w-0">
                            <p className="font-medium">{LABEL[e.kind]}</p>
                            <p className="min-w-0 truncate text-xs text-muted-foreground">
                                {e.kind === "minted" && e.to && (
                                    <>
                                        to <AccountLink address={e.to} />
                                    </>
                                )}
                                {(e.kind === "transferred" || e.kind === "sold") &&
                                    e.from &&
                                    e.to && (
                                        <>
                                            <AccountLink address={e.from} /> to{" "}
                                            <AccountLink address={e.to} />
                                        </>
                                    )}
                                {(e.kind === "listed" || e.kind === "cancelled") && e.by && (
                                    <>
                                        by <AccountLink address={e.by} />
                                    </>
                                )}
                            </p>
                        </div>
                        <div className="shrink-0 text-right">
                            {e.priceMutez !== undefined && (
                                <p className="font-medium tabular-nums">
                                    {formatTez(e.priceMutez)} ꜩ
                                </p>
                            )}
                            <p className="text-xs text-muted-foreground">
                                <TimeAgo iso={e.at} short />
                            </p>
                        </div>
                    </li>
                ))}
            </ul>
        </div>
    );
}
