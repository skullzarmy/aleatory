import { renderLogo, seedOfTheDay, CANONICAL_SEED } from "@/lib/logo";

/**
 * The mark.
 *
 * `daily` draws today's variant, which is the same for everyone looking at
 * the site on a given date, so a server render and a client render agree.
 * Anything that has to stay fixed forever uses the canonical seed.
 */
export function Logo({
    size = 40,
    daily = false,
    detail = "full",
    className,
}: {
    size?: number;
    daily?: boolean;
    detail?: "full" | "compact";
    className?: string;
}) {
    const svg = renderLogo({
        seed: daily ? seedOfTheDay() : CANONICAL_SEED,
        size,
        detail,
    });

    return (
        <span
            className={className}
            style={{ display: "inline-flex", width: size, height: size }}
            dangerouslySetInnerHTML={{ __html: svg }}
        />
    );
}
