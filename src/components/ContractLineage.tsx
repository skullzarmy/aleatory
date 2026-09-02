"use client";

import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { lineage, type Held, type Lineage } from "@/lib/router";
import { tzktLink } from "@/lib/config";
import { shortAddress } from "@/lib/utils";

/**
 * Every contract the router names, read in the visitor's own browser.
 *
 * Resolved here rather than on the server so the list is the chain's answer to
 * a question the reader asked, arriving over a connection they control. A page
 * about what we cannot quietly change should not itself be a thing we render
 * and hand over.
 *
 * Retired contracts are listed beside current ones because they are still
 * real: collections a retired factory originated belong to real artists, and a
 * retired marketplace still holds the listings and escrowed offers made on it.
 */

const ROLES = [
    {
        key: "factories" as const,
        title: "Factories",
        blurb: "Originates collections. A new one is added to the router, and every collection an earlier one made keeps working.",
    },
    {
        key: "marketplaces" as const,
        title: "Marketplaces",
        blurb: "Listings, offers and the platform fee. A retired one still holds the listings and escrowed offers made on it.",
    },
    {
        key: "registries" as const,
        title: "Registries",
        blurb: "The list of render providers. Anyone can add themselves, and nobody can be removed.",
    },
    {
        key: "resolvers" as const,
        title: "Resolvers",
        blurb: "Which keys may write resolution entries.",
    },
];

export function ContractLineage() {
    const [state, setState] = useState<Lineage | null>(null);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        void lineage()
            .then(setState)
            .catch(() => setFailed(true));
    }, []);

    if (failed) {
        return (
            <p className="mt-8 text-sm text-muted-foreground">
                The chain could not be reached. Nothing here is cached, so there is nothing to show
                until it can be.
            </p>
        );
    }

    if (!state) {
        return <p className="mt-8 text-sm text-muted-foreground">Reading the chain…</p>;
    }

    if (!state.router) {
        return (
            <p className="mt-8 text-sm text-muted-foreground">
                No router is configured for this deployment.
            </p>
        );
    }

    return (
        <div className="mt-8 space-y-10">
            <section>
                <h2 className="text-base font-medium">Router</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                    The one address this site is configured with. Everything below is read from it,
                    so a redeploy cannot leave a page pointing at a contract that no longer exists.
                </p>
                <ul className="mt-3 rounded-lg border border-border">
                    <Row held={{ address: state.router, current: true, since: null, op: null }} />
                </ul>
            </section>

            {ROLES.map(({ key, title, blurb }) => {
                const held = state[key];
                if (held.length === 0) return null;
                return (
                    <section key={key}>
                        <h2 className="text-base font-medium">
                            {title}
                            <span className="ml-2 text-xs font-normal text-muted-foreground">
                                {held.length}
                            </span>
                        </h2>
                        <p className="mt-1 text-sm text-muted-foreground">{blurb}</p>
                        <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
                            {held.map((h) => (
                                <Row key={h.address} held={h} />
                            ))}
                        </ul>
                    </section>
                );
            })}

            {state.truncated && (
                <p className="text-xs text-muted-foreground">
                    The router has more history than this page reads, so the oldest entries are
                    missing. All of it is on chain.
                </p>
            )}
        </div>
    );
}

function Row({ held }: { held: Held }) {
    return (
        <li className="flex items-center justify-between gap-4 px-4 py-3">
            <span className="min-w-0">
                <a
                    href={tzktLink(held.address)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 font-mono text-sm hover:text-foreground hover:underline"
                >
                    {shortAddress(held.address, 8, 6)}
                    <ExternalLink size={12} aria-hidden />
                </a>
                <span className="block text-xs text-muted-foreground">
                    {held.since ? (
                        <>
                            adopted{" "}
                            {held.op ? (
                                <a
                                    href={tzktLink(held.op)}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="hover:text-foreground hover:underline"
                                >
                                    {new Date(held.since).toISOString().slice(0, 10)}
                                </a>
                            ) : (
                                new Date(held.since).toISOString().slice(0, 10)
                            )}
                        </>
                    ) : (
                        "named when the router was originated"
                    )}
                </span>
            </span>
            {held.current ? (
                <span className="shrink-0 rounded bg-alea-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-alea-800 dark:bg-alea-900 dark:text-alea-100">
                    current
                </span>
            ) : (
                <span className="shrink-0 text-xs text-muted-foreground">retired</span>
            )}
        </li>
    );
}
