"use client";

import { useEffect, useState } from "react";
import { fetchProfile, avatarUrl } from "@/lib/identity";
import { ipfsImageUrl } from "@/utils/ipfs";

/**
 * A face for an address.
 *
 * Their picture where they set one, the hackatar where they have a hack.tez
 * name, and their initial where neither. Never an empty circle: a grid of
 * identical blank discs is worse than no avatars at all, because it reads as
 * broken rather than as absent.
 *
 * Sized in pixels rather than by class so a caller cannot half-apply a size and
 * get a squashed image.
 */
export function Avatar({
    address,
    size = 32,
    /** Skips the lookup when the caller already has the picture. */
    src,
    /** Round for people, square for contracts. Nothing else distinguishes them at a glance. */
    shape = "circle",
    /** What the initial comes from. The address, unless there is a better name. */
    fallback,
    className,
}: {
    address: string;
    size?: number;
    src?: string | null;
    shape?: "circle" | "square";
    fallback?: string;
    className?: string;
}) {
    const [url, setUrl] = useState<string | null>(src ?? null);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        if (src !== undefined) {
            setUrl(src);
            return;
        }
        let live = true;
        void fetchProfile(address).then((p) => {
            if (live) setUrl(avatarUrl(p));
        });
        return () => {
            live = false;
        };
    }, [address, src]);

    const resolved = url?.startsWith("ipfs://") ? ipfsImageUrl(url) : url;
    const round = shape === "circle" ? "rounded-full" : "rounded-md";

    if (!resolved || failed) {
        return (
            <span
                aria-hidden
                className={`inline-flex shrink-0 select-none items-center justify-center ${round} bg-muted font-medium uppercase text-muted-foreground ${className ?? ""}`}
                style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
            >
                {(fallback || address.slice(3)).slice(0, 1)}
            </span>
        );
    }

    return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
            src={resolved}
            alt=""
            width={size}
            height={size}
            onError={() => setFailed(true)}
            className={`shrink-0 ${round} object-cover ${className ?? ""}`}
            style={{ width: size, height: size }}
        />
    );
}
