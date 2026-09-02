import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { fetchProviders, RANKING_WINDOW_DAYS } from "@/lib/providers";
import { isAddress } from "@/lib/tzkt";
import { tzktLink } from "@/lib/config";
import { formatTez, shortAddress, timeAgo } from "@/lib/utils";
import { convertIpfsToGatewayUrl } from "@/utils/ipfs";
import { Avatar } from "@/components/account/Avatar";
import { AccountLink } from "@/components/account/AccountLink";

export const revalidate = 300;

export async function generateMetadata({
    params,
}: {
    params: Promise<{ address: string }>;
}): Promise<Metadata> {
    const { address } = await params;
    return {
        title: `Provider ${shortAddress(address)}`,
        alternates: { canonical: `/providers/${address}` },
    };
}

/**
 * One provider's record.
 *
 * The ranked list answers "who should I pick". This answers "what has this one
 * actually done", which is the question an artist has once a piece of theirs is
 * sitting unrendered. Every figure is measured, not claimed: a provider cannot
 * write anything on this page.
 */
export default async function ProviderPage({ params }: { params: Promise<{ address: string }> }) {
    const { address } = await params;
    if (!isAddress(address)) notFound();

    const provider = (await fetchProviders().catch(() => [])).find((p) => p.address === address);

    if (!provider) {
        return (
            <div className="mx-auto max-w-md px-4 py-16 text-center">
                <h1 className="text-lg font-semibold">Not in the registry</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                    {shortAddress(address)} has not listed itself as a provider on this network.
                    Listing is free and open to anyone.
                </p>
                <Link
                    href="/providers"
                    className="mt-6 inline-block rounded-md border border-border px-4 py-2 text-sm hover:bg-accent"
                >
                    All providers
                </Link>
            </div>
        );
    }

    const { stats } = provider;

    return (
        <div className="mx-auto max-w-2xl px-4 py-8">
            <Link
                href="/providers"
                className="text-xs text-muted-foreground underline hover:text-foreground"
            >
                All providers
            </Link>

            <h1 className="mt-3 flex flex-wrap items-center gap-3 text-xl font-semibold tracking-tight">
                <Avatar
                    address={provider.address}
                    src={provider.avatarUri ?? null}
                    shape="square"
                    size={48}
                    fallback={provider.name}
                />
                <span className="min-w-0 break-words">
                    {provider.name || shortAddress(provider.address)}
                </span>
                {provider.isOurs && (
                    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                        ours
                    </span>
                )}
            </h1>

            {provider.description && (
                <p className="mt-2 max-w-prose break-words text-sm text-muted-foreground">
                    {provider.description}
                </p>
            )}

            <p className="mt-1 text-xs text-muted-foreground">
                <a
                    href={tzktLink(provider.address)}
                    target="_blank"
                    rel="noreferrer"
                    className="break-all underline hover:text-foreground"
                >
                    {provider.address}
                </a>
            </p>

            <div className="mt-8 grid gap-4 sm:grid-cols-3">
                <Stat
                    value={String(stats.delivered)}
                    label="pieces published"
                    detail={`in the last ${RANKING_WINDOW_DAYS} days`}
                />
                <Stat
                    value={
                        stats.medianBlocksToPublish === null
                            ? "—"
                            : String(stats.medianBlocksToPublish)
                    }
                    label="blocks to publish"
                    detail="typical wait after a mint"
                />
                <Stat
                    value={String(stats.outstanding)}
                    label="still waiting"
                    detail={stats.outstanding === 0 ? "no backlog" : "running late"}
                />
            </div>

            <dl className="mt-8 divide-y divide-border rounded-lg border border-border text-sm">
                <Row label="Price per piece" value={`${formatTez(provider.renderGasMutez)} ꜩ`} />
                <Row
                    label="Signing address"
                    value={
                        provider.agent ? <AccountLink address={provider.agent} /> : "not published"
                    }
                />
                {provider.endpoint && <Row label="Push endpoint" value={provider.endpoint} />}
                <Row
                    label="Listed"
                    value={provider.registeredAt ? timeAgo(provider.registeredAt) : "unknown"}
                />
                <Row
                    label="Active since"
                    value={stats.firstSeen ? timeAgo(stats.firstSeen) : "no deliveries yet"}
                />
            </dl>

            <p className="mt-6 text-xs leading-relaxed text-muted-foreground">
                Anyone can run a provider and set their own price. If you use this one and it stops
                working, you can switch at any time and nothing you have already sold is affected.
            </p>
        </div>
    );
}

function Stat({ value, label, detail }: { value: string; label: string; detail: string }) {
    return (
        <div className="rounded-lg border border-border p-4">
            <p className="text-2xl font-semibold tracking-tight">{value}</p>
            <p className="mt-0.5 text-sm">{label}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>
        </div>
    );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
    return (
        <div className="flex items-baseline justify-between gap-4 px-4 py-2.5">
            <dt className="shrink-0 text-muted-foreground">{label}</dt>
            <dd className="min-w-0 truncate text-right font-medium">{value}</dd>
        </div>
    );
}
