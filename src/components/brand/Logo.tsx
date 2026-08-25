"use client";

import { useState } from "react";
import { renderLogo, CANONICAL_SEED } from "@/lib/logo";

/**
 * The mark, drawn fresh on every load.
 *
 * One render, a new seed each time the component mounts.
 */
export function Logo({
    size = 40,
    fixed = false,
    detail = "full",
    label = "Aleatory",
    className,
}: {
    size?: number;
    /** Hold the canonical mark instead of drawing a new one. */
    fixed?: boolean;
    detail?: "full" | "compact";
    /** Empty marks it decorative, for when it sits beside the word. */
    label?: string;
    className?: string;
}) {
    const [seed] = useState(() =>
        fixed ? CANONICAL_SEED : `${Date.now()}-${Math.random()}`,
    );

    return (
        <span
            className={className}
            suppressHydrationWarning
            style={{ display: "inline-flex", width: size, height: size }}
            dangerouslySetInnerHTML={{
                __html: renderLogo({ seed, size, detail, label }),
            }}
        />
    );
}
