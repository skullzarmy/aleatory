"use client";

import Link from "next/link";
import { AccountName } from "./AccountName";
import { Avatar } from "./Avatar";

// Links to /wallet/{address}. The block explorer link lives only on that
// page, next to the address it verifies.
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
