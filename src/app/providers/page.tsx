import type { Metadata } from "next";
import Link from "next/link";
import {
    fetchProviders,
    RANKING_METHOD,
    RANKING_WINDOW_DAYS,
    type Provider,
} from "@/lib/providers";
import { convertIpfsToGatewayUrl } from "@/utils/ipfs";
import { formatTez, shortAddress } from "@/lib/utils";

export const metadata: Metadata = { title: "Render providers" };
export const revalidate = 300;

/**
 * Every registered provider, ranked by what they have delivered.
 *
 * The method is printed on the page and the query is in the open, so anyone
 * can recompute this list and order it differently.
 */
export default async function ProvidersPage() {
    const providers = await fetchProviders().catch(() => []);

    return (
        <div className="mx-auto max-w-3xl px-4 py-8">
            <h1 className="text-xl font-semibold tracking-tight">Render providers</h1>
            <p className="mt-2 text-sm text-muted-foreground">
                A provider draws the images for minted pieces. Anyone can run one, list it
                here for free, and set their own price.
            </p>

            {providers.length === 0 ? (
                <div className="mt-8 rounded-lg border border-dashed border-border px-6 py-16 text-center">
                    <h2 className="text-base font-medium">No providers yet</h2>
                    <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                        Nobody has listed one yet.
                    </p>
                </div>
            ) : (
                <ul className="mt-8 divide-y divide-border rounded-lg border border-border">
                    {providers.map((p) => (
                        <li key={p.address}>
                        <Link
                            href={`/providers/${p.address}`}
                            className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-accent"
                        >
                            <Avatar provider={p} />
                            <span className="min-w-0 flex-1">
                                <span className="flex items-center gap-2">
                                    <span className="truncate font-medium">
                                        {p.name || shortAddress(p.address)}
                                    </span>
                                    {p.isOurs && (
                                        <span className="rounded bg-alea-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-alea-800 dark:bg-alea-900 dark:text-alea-100">
                                            ours
                                        </span>
                                    )}
                                </span>
                                {p.description && (
                                    <span className="block truncate text-xs text-muted-foreground">
                                        {p.description}
                                    </span>
                                )}
                                <span className="block text-xs text-muted-foreground">
                                    {p.stats.delivered} published in {RANKING_WINDOW_DAYS} days
                                    {p.stats.medianBlocksToPublish !== null &&
                                        `, ${p.stats.medianBlocksToPublish} blocks to publish`}
                                    {p.stats.outstanding > 0 && `, ${p.stats.outstanding} waiting`}
                                </span>
                            </span>
                            <span className="shrink-0 text-sm font-medium">
                                {formatTez(p.renderGasMutez)} ꜩ
                            </span>
                        </Link>
                        </li>
                    ))}
                </ul>
            )}

            <p className="mt-4 text-xs text-muted-foreground">{RANKING_METHOD}</p>
        </div>
    );
}

/** A provider's own logo, or its initial. Presentation only. */
function Avatar({ provider }: { provider: Provider }) {
    const url = provider.avatarUri ? convertIpfsToGatewayUrl(provider.avatarUri) : "";
    if (url) {
        // eslint-disable-next-line @next/next/no-img-element
        return (
            <img
                src={url}
                alt=""
                className="h-10 w-10 shrink-0 rounded-md object-cover"
            />
        );
    }
    return (
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted text-sm font-medium text-muted-foreground">
            {(provider.name || provider.address.slice(3, 4)).slice(0, 1).toUpperCase()}
        </span>
    );
}
