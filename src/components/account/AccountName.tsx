"use client";

import { useEffect, useState } from "react";
import { resolveName } from "@/lib/identity";
import { shortAddress } from "@/lib/utils";

/**
 * An address, called by its name where it has one. The truncated address
 * renders first and the name replaces it, since a name needs a network round
 * trip. The full address stays in the title, because a name is a claim about an
 * address and the address settles it.
 */
export function AccountName({ address, className }: { address: string; className?: string }) {
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
