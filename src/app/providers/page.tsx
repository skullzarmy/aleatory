import type { Metadata } from "next";
import Link from "next/link";
import { fetchProviders, RANKING_WINDOW_DAYS, type Provider } from "@/lib/providers";
import { formatTez, shortAddress } from "@/lib/utils";
import { BRAND } from "@/lib/config";
import { Avatar } from "@/components/account/Avatar";

export const metadata: Metadata = {
    title: "Render providers",
    alternates: { canonical: "/providers" },
    openGraph: {
        type: "website",
        title: "Render providers",
        description: "Anyone can run one. The membership test is three views on a contract.",
    },
};
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
                A provider draws the images for minted pieces. Anyone can run one, list it here for
                free, and set their own price.
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
                                <Avatar
                                    address={p.address}
                                    src={p.avatarUri ?? null}
                                    shape="square"
                                    size={40}
                                    fallback={p.name}
                                />
                                <span className="min-w-0 flex-1">
                                    <span className="flex items-center gap-2">
                                        <span className="min-w-0 truncate font-medium">
                                            {p.name || shortAddress(p.address)}
                                        </span>
                                        {p.isOurs && (
                                            <span className="shrink-0 rounded bg-alea-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-alea-800 dark:bg-alea-900 dark:text-alea-100">
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
                                        {p.stats.outstanding > 0 &&
                                            `, ${p.stats.outstanding} waiting`}
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

            <p className="mt-4 text-xs text-muted-foreground">
                Sorted by pieces published in the last {RANKING_WINDOW_DAYS} days, then by the share
                still waiting, then by median blocks from buy to publish, then by time in service.
                Every figure is computed from public chain events.
            </p>

            <RunOne />
        </div>
    );
}

/**
 * The pitch, for anyone who could run one.
 *
 * The page listed providers and ranked them and never said how to become one,
 * which for a role the whole design depends on being contestable is the wrong
 * thing to leave out. If nobody else can plausibly run one, the openness is
 * decorative.
 */
function RunOne() {
    return (
        <section className="mt-12 rounded-lg border border-border p-6">
            <h2 className="text-base font-medium">Run one</h2>
            <p className="mt-2 text-sm text-muted-foreground">
                Deploy a contract, call <code className="font-mono text-xs">register</code> on the
                registry, and you are listed. It is permissionless and free: the registry checks
                your contract answers three views and lists it if it does. Nobody reviews you,
                nobody approves you, and nobody can refuse you or remove you.
            </p>

            <dl className="mt-5 space-y-3 text-sm">
                <div>
                    <dt className="font-medium">What you earn</dt>
                    <dd className="mt-1 text-muted-foreground">
                        You set your own render gas, paid to your contract by every mint of every
                        collection that picked you, in the same operation that pays the artist. A
                        publish costs about 0.0015 ꜩ in chain fees against it.
                    </dd>
                </div>
                <div>
                    <dt className="font-medium">What you are judged on</dt>
                    <dd className="mt-1 text-muted-foreground">
                        Pieces published and pieces left waiting. Price is not part of the ranking,
                        so undercutting moves you nowhere; delivering does. Every figure above is
                        computed from public chain events, so you can check ours and rank us below
                        you.
                    </dd>
                </div>
                <div>
                    <dt className="font-medium">What it takes to run</dt>
                    <dd className="mt-1 text-muted-foreground">
                        A headless browser, somewhere to pin what it draws, and a key with a few tez
                        in it that signs nothing but metadata. The daemon in our repository is one
                        implementation and you are not obliged to use it.
                    </dd>
                </div>
            </dl>

            <div className="mt-5 flex flex-wrap gap-3">
                <a
                    href={`${BRAND.repo}/blob/main/docs/provider.md`}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-md bg-alea-600 px-4 py-2 text-sm font-medium text-white hover:bg-alea-700"
                >
                    Running a render provider
                </a>
                <Link
                    href="/docs/interface"
                    className="rounded-md border border-border px-4 py-2 text-sm hover:bg-accent"
                >
                    ALEATORY-001 §5
                </Link>
            </div>

            <p className="mt-4 text-xs text-muted-foreground">
                Nothing in our implementation is required. Conform to the interface and the rest is
                yours.
            </p>
        </section>
    );
}
