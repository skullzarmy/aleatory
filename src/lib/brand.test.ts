/**
 * The accent colour, against the text that sits on it.
 *
 * `bg-alea-600` with white text is the primary control on nearly every page,
 * so it is the single pair most worth holding to WCAG 2.2 AA. A palette is
 * also the easiest thing in a codebase to change on taste alone, months later,
 * without anyone thinking to measure it.
 *
 * Ratios are read out of tailwind.config.ts rather than written here, so this
 * measures the palette that ships instead of a copy of it.
 *
 * Run: npm test
 */

import { readFileSync } from "node:fs";

let failures = 0;

function check(name: string, ratio: number, need: number) {
    const ok = ratio >= need;
    if (!ok) failures++;
    console.log(
        `  ${ok ? "ok  " : "FAIL"} ${ratio.toFixed(2).padStart(5)}:1  (needs ${need}:1)  ${name}`,
    );
}

const channels = (hex: string) =>
    (hex.replace("#", "").match(/../g) ?? []).map((h) => parseInt(h, 16) / 255);

const linear = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

function luminance(hex: string): number {
    const [r, g, b] = channels(hex).map(linear);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
}

/** `230 10% 10%` as it is written in globals.css, into something measurable. */
function hslToHex(h: number, s: number, l: number): string {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    const [r, g, b] =
        h < 60 ? [c, x, 0]
        : h < 120 ? [x, c, 0]
        : h < 180 ? [0, c, x]
        : h < 240 ? [0, x, c]
        : h < 300 ? [x, 0, c]
        : [c, 0, x];
    const to = (v: number) =>
        Math.round((v + m) * 255).toString(16).padStart(2, "0");
    return `#${to(r)}${to(g)}${to(b)}`;
}

/**
 * The page colours, both themes, from the stylesheet.
 *
 * Measuring against white and black would be measuring a page nobody renders:
 * neither theme uses either, and the dark one is a good deal lighter than
 * black, which is the direction that makes an accent harder to see rather than
 * easier.
 */
function backgrounds(): { light: string; dark: string } {
    const css = readFileSync("src/app/globals.css", "utf8");
    const found = [...css.matchAll(/--background:\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/g)].map(
        (m) => hslToHex(Number(m[1]), Number(m[2]) / 100, Number(m[3]) / 100),
    );
    if (found.length < 2) throw new Error("could not read both --background values");
    // Declared light first, then dark, as the file is ordered.
    return { light: found[0], dark: found[1] };
}

/** The `alea` scale, from the config the site is actually built with. */
function palette(): Record<string, string> {
    const config = readFileSync("tailwind.config.ts", "utf8");
    const block = config.slice(config.indexOf("alea: {"), config.indexOf("background:"));
    const out: Record<string, string> = {};
    for (const m of block.matchAll(/"(\d+)":\s*"(#[0-9a-fA-F]{6})"/g)) {
        out[m[1]] = m[2];
    }
    return out;
}

console.log("\nBrand colour\n");

const alea = palette();
const WHITE = "#ffffff";

check("the scale was read at all", Object.keys(alea).length >= 9 ? 99 : 0, 1);

// Every step a component actually uses, and what sits on it. Grepped from the
// components rather than assumed: 600 and 700 carry white, and the pair
// 100/800 and 900/100 are the badge in both themes.
check("white on alea-600, the primary button", contrast(WHITE, alea["600"]), 4.5);
check("white on alea-700, its hover", contrast(WHITE, alea["700"]), 4.5);
check("alea-800 on alea-100, badge in light", contrast(alea["800"], alea["100"]), 4.5);
check("alea-100 on alea-900, badge in dark", contrast(alea["100"], alea["900"]), 4.5);

// 1.4.11: a filled button is identified by its fill, so the fill has to be
// distinguishable from the page behind it in both themes.
const page = backgrounds();
console.log(`\n  page is ${page.light} light, ${page.dark} dark\n`);
check(`alea-600 on the light page ${page.light}`, contrast(alea["600"], page.light), 3);
check(`alea-600 on the dark page ${page.dark}`, contrast(alea["600"], page.dark), 3);

console.log(
    failures === 0
        ? "\nEvery pair clears AA.\n"
        : `\n${failures} pair(s) below AA.\n`,
);
process.exit(failures === 0 ? 0 : 1);
