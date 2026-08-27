import type { Config } from "tailwindcss";

/**
 * `<alpha-value>` is what lets `bg-warn/10` and `border-line/40` work. The
 * variables in globals.css hold bare RGB channels for this reason.
 */
const channel = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
    content: ["./src/**/*.{ts,tsx}"],
    theme: {
        extend: {
            colors: {
                base: channel("base"),
                sunk: channel("sunk"),
                line: channel("line"),
                fg: channel("fg"),
                dim: channel("dim"),
                ok: channel("ok"),
                warn: channel("warn"),
                bad: channel("bad"),
            },
        },
    },
    plugins: [],
} satisfies Config;
