"use client";

import Link from "next/link";
import { useWallet } from "@/context/WalletContext";
import { AccountName } from "@/components/AccountName";
import { ChevronDown, Images, LogOut, Wallet } from "lucide-react";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function ConnectButton() {
    const { address, connecting, restoring, connect, disconnect } = useWallet();

    if (restoring) return <div className="h-9 w-28" aria-hidden />;

    if (address) {
        return (
            <DropdownMenu>
                <DropdownMenuTrigger className="inline-flex h-9 max-w-[13rem] items-center gap-2 rounded-md border border-border px-3 text-sm font-medium transition-colors hover:bg-accent data-[state=open]:bg-accent">
                    <span className="h-2 w-2 shrink-0 rounded-full bg-success" />
                    <AccountName address={address} className="truncate" />
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                </DropdownMenuTrigger>

                <DropdownMenuContent align="end" className="w-64">
                    {/* The address itself, because the trigger shows a name
                        and a name is a claim the address is what settles. */}
                    <DropdownMenuLabel className="break-all font-mono text-xs font-normal text-muted-foreground">
                        {address}
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />

                    <DropdownMenuItem asChild>
                        <Link href="/mine">
                            <Images />
                            What you own
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
