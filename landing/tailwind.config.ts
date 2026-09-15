import type { Config } from "tailwindcss";

export default {
    darkMode: "media",
    content: [
        "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
        "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
        "./src/lib/**/*.{js,ts,jsx,tsx,mdx}",
    ],
    theme: {
        extend: {
            colors: {
                // Aleatory's own accent; the rest of the tokens are shared
                // with rejkt.
                //
                // Royal blue (#4169e1) carries white text at 4.85:1, just
                // clearing AA. The 600 shade used on the one control that
                // appears on every page sits at 6.64:1. Ratios are asserted
                // in brand.test.ts.
                alea: {
                    "50": "#f0f4ff",
                    "100": "#dae4fd",
                    "200": "#b9cbfb",
                    "300": "#8da9f4",
                    "400": "#6084e9",
                    "500": "#4770e1",
                    "600": "#3c67dd",
                    "700": "#2750c1",
                    "800": "#244399",
                    "900": "#203777",
                },
                background: "hsl(var(--background))",
                foreground: "hsl(var(--foreground))",
                card: {
                    DEFAULT: "hsl(var(--card))",
                    foreground: "hsl(var(--card-foreground))",
                    background: "hsl(var(--card-background))",
                },
                popover: {
                    DEFAULT: "hsl(var(--popover))",
                    foreground: "hsl(var(--popover-foreground))",
                },
                primary: {
                    DEFAULT: "hsl(var(--primary))",
                    foreground: "hsl(var(--primary-foreground))",
                },
                secondary: {
                    DEFAULT: "hsl(var(--secondary))",
                    foreground: "hsl(var(--secondary-foreground))",
                },
                muted: {
                    DEFAULT: "hsl(var(--muted))",
                    foreground: "hsl(var(--muted-foreground))",
                },
                accent: {
                    DEFAULT: "hsl(var(--accent))",
                    foreground: "hsl(var(--accent-foreground))",
                },
                destructive: {
                    DEFAULT: "hsl(var(--destructive))",
                    foreground: "hsl(var(--destructive-foreground))",
                },
                border: "hsl(var(--border))",
                input: "hsl(var(--input))",
                ring: "hsl(var(--ring))",
                warning: {
                    DEFAULT: "hsl(var(--warning))",
                    foreground: "hsl(var(--warning-foreground))",
                },
                success: {
                    DEFAULT: "hsl(var(--success))",
                    foreground: "hsl(var(--success-foreground))",
                },
            },
            borderRadius: {
                lg: "var(--radius)",
                md: "calc(var(--radius) - 2px)",
                sm: "calc(var(--radius) - 4px)",
            },
        },
    },
    // The app's copy carries accordion and shimmer keyframes and the
    // `tailwindcss-animate` plugin for them. There is nothing here that opens,
    // closes or loads, and a dependency this page never uses is one it should
    // not have to install.
    plugins: [],
} satisfies Config;
