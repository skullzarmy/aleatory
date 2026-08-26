"use client";

import { useEffect, useState } from "react";
import { resolveName } from "@/lib/identity";
import { shortAddress } from "@/lib/utils";

/**
 * An address, called by its name where it has one.
 *
 * The truncated address renders first and the name replaces it, the same way
 * TimeAgo renders an absolute time and then makes it relative: a name needs a
 * network round trip, and holding the whole surface back for one would be a
 * blank space where a perfectly good address could have been.
 *
 * The full address stays in the title, because a name is a claim about an
 * address and the address is what settles it.
 */
export function AccountName({
    address,
    className,
}: {
    address: string;
    className?: string;
}) {
    const [name, setName] = useState<string | null>(null);

    useEffect(() => {
        let live = true;
        void resolveName(address).then((n) => {
            if (live) setName(n);
        });
        return () => {
            live = false;
        };
    }, [address]);

    return (
        <span className={className} title={address}>
            {name ?? shortAddress(address)}
        </span>
    );
}
