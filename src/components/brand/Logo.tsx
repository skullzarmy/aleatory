"use client";

import { useEffect, useState } from "react";
import { renderLogo, CANONICAL_SEED } from "@/lib/logo";

/**
 * The mark, drawn fresh on every load.
 *
 * The server renders the canonical mark and the client replaces it with a new
 * one once mounted, so there is no hydration mismatch and no layout shift.
 * Anything that must stay fixed forever uses the canonical seed directly.
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
    const [seed, setSeed] = useState(CANONICAL_SEED);

    useEffect(() => {
        if (fixed) return;
        setSeed(`${Date.now()}-${Math.random()}`);
    }, [fixed]);

    return (
        <span
            className={className}
            style={{ display: "inline-flex", width: size, height: size }}
            dangerouslySetInnerHTML={{
                __html: renderLogo({ seed, size, detail, label }),
            }}
        />
    );
}
