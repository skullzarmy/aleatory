"use client";

import { useState } from "react";
import Link from "next/link";
import { useWallet } from "@/context/WalletContext";
import { useOffers } from "@/context/OffersContext";
import { AccountName } from "@/components/account/AccountName";
import { shortAddress } from "@/lib/utils";
import { Check, ChevronDown, Copy, LogOut, Settings2, Tag, User, Wallet } from "lucide-react";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * The address, short, with the only reason anyone wanted it in full.
 *
 * It used to print all thirty six characters and wrap onto two lines. Nobody
 * reads an address; they compare the ends of it or they copy it, and both work
 * better truncated with a button beside it.
 */
function AddressLine({ address }: { address: string }) {
    const [copied, setCopied] = useState(false);

    return (
        <div className="flex items-center justify-between gap-2 px-2 py-1.5">
            <span className="font-mono text-xs text-muted-foreground">{shortAddress(address)}</span>
            <button
                type="button"
                onClick={() => {
                    void navigator.clipboard.writeText(address).then(() => {
                        setCopied(true);
                        window.setTimeout(() => setCopied(false), 1200);
                    });
                }}
                aria-label={copied ? "Address copied" : "Copy address"}
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
            >
                {copied ? (
                    <Check className="h-3.5 w-3.5 text-success" />
                ) : (
                    <Copy className="h-3.5 w-3.5" />
                )}
            </button>
        </div>
    );
}

export function ConnectButton() {
    const { address, connecting, restoring, connect, disconnect } = useWallet();
    // Above the early returns below. Hooks run in the same order every render
    // or React loses track of which state belongs to which call, and a
    // component that returns before one has changed its shape.
    const { incoming, unseen } = useOffers();

    if (restoring) return <div className="h-9 w-24 sm:w-28" aria-hidden />;

    if (address) {
        return (
            <DropdownMenu>
                <DropdownMenuTrigger className="relative inline-flex h-9 min-w-0 max-w-[8.5rem] items-center gap-2 rounded-md border border-border px-3 text-sm font-medium transition-colors hover:bg-accent data-[state=open]:bg-accent sm:max-w-[13rem]">
                    <span className="h-2 w-2 shrink-0 rounded-full bg-success" />
                    <AccountName address={address} className="truncate" />
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />

                    {/* On the corner rather than beside the green one, which
                        says the wallet is connected. Two dots in a row read as
                        two states of the same thing.

                        The ring is what keeps it legible where it overlaps the
                        border, and it has to match the header's own background
                        rather than the page's. */}
                    {unseen > 0 && (
                        <span
                            aria-hidden
                            className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-alea-600 ring-2 ring-background"
                        />
                    )}
                    {/* A coloured dot is nothing to a screen reader, and the
                        trigger otherwise announces only a name. */}
                    {incoming.length > 0 && (
                        <span className="sr-only">
                            {`, ${incoming.length} ${incoming.length === 1 ? "offer" : "offers"} on your pieces${
                                unseen > 0 ? `, ${unseen} new` : ""
                            }`}
                        </span>
                    )}
                </DropdownMenuTrigger>

                <DropdownMenuContent align="end" className="w-60">
                    {/* The trigger shows a name, and a name is a claim. This is
                        the thing that actually settles. */}
                    <AddressLine address={address} />
                    <DropdownMenuSeparator />

                    {/* Straight to the page rather than through /mine, which
                        only exists to work out this address and redirect here.
                        This menu already knows it. */}
                    <DropdownMenuItem asChild>
                        <Link href={`/wallet/${address}`}>
                            <User />
                            Your page
                        </Link>
                    </DropdownMenuItem>

                    {/* Only when there is something there. An offers row
                        reading zero is a menu grown one line longer to say
                        nothing, and the page is still reachable at /offers. */}
                    {incoming.length > 0 && (
                        <DropdownMenuItem asChild>
                            <Link href="/offers">
                                <Tag />
                                Offers
                                <span className="ml-auto rounded-full bg-muted px-1.5 text-xs font-normal tabular-nums text-muted-foreground">
                                    {incoming.length}
                                </span>
                            </Link>
                        </DropdownMenuItem>
                    )}

                    {/* Not another view of the same public data: the levers
                        only this wallet can pull, because the contract names
                        it administrator. */}
                    <DropdownMenuItem asChild>
                        <Link href="/manage">
                            <Settings2 />
                            Manage collections
                        </Link>
                    </DropdownMenuItem>

                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                        onSelect={() => void disconnect()}
                        className="text-destructive focus:text-destructive"
                    >
                        <LogOut />
                        Disconnect
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
        );
    }

    return (
        <button
            type="button"
            onClick={() => void connect()}
            disabled={connecting}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-alea-600 px-3 text-sm font-medium text-white transition-colors hover:bg-alea-700 disabled:opacity-60"
        >
            <Wallet className="h-4 w-4" />
            {connecting ? "Connecting" : "Connect"}
        </button>
    );
}
