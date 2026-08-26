"use client";

import Link from "next/link";
import { AccountName } from "./AccountName";
import { Avatar } from "./Avatar";

/**
 * The way to show an account. Every account, everywhere.
 *
 * It goes to `/wallet/{address}`, which is the page about that person: what
 * they made and what they hold, with their profile on top. Sending a reader to
 * a block explorer instead was the old behaviour, and a block explorer is where
 * you go to check an operation, not to find out who made something.
 *
 * The chain explorer link still exists. It lives once, on the account's own
 * page, next to the address it verifies.
 */
export function AccountLink({
    address,
    withAvatar = false,
    size = 20,
    className,
}: {
    address: string;
    withAvatar?: boolean;
    size?: number;
    className?: string;
}) {
    return (
        <Link
            href={`/wallet/${address}`}
            className={`inline-flex min-w-0 items-center gap-1.5 hover:underline ${className ?? ""}`}
        >
            {withAvatar && <Avatar address={address} size={size} />}
            <AccountName address={address} className="truncate" />
        </Link>
    );
}
