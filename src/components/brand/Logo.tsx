import { renderLogo, seedOfTheDay, CANONICAL_SEED } from "@/lib/logo";

/**
 * The mark.
 *
 * `daily` draws today's variant, the same for everyone on a given date so a
 * server render and a client render agree. Anything that has to stay fixed
 * uses the canonical seed.
 *
 * The SVG carries its own `role` and `aria-label`, so a caller wrapping this
 * in a link should label the link for where it goes and leave the mark to
 * name itself.
 */
export function Logo({
    size = 40,
    daily = false,
    detail = "full",
    label = "Aleatory",
    className,
}: {
    size?: number;
    daily?: boolean;
    detail?: "full" | "compact";
    /** Pass an empty string when the mark is decorative next to real text. */
    label?: string;
    className?: string;
}) {
    const svg = renderLogo({
        seed: daily ? seedOfTheDay() : CANONICAL_SEED,
        size,
        detail,
        label,
    });

    return (
        <span
            className={className}
            style={{ display: "inline-flex", width: size, height: size }}
            dangerouslySetInnerHTML={{ __html: svg }}
        />
    );
}
