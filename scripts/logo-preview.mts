/**
 * Look at the mark across seeds.
 *
 *   npx tsx scripts/logo-preview.mts aleatory drift-01 drift-02
 *
 * Writes full and compact renders to /tmp/logo, plus favicon-size versions,
 * because the only way to know a mark works small is to look at it small.
 */
import { renderLogo } from "../src/lib/logo";
import { writeFileSync, mkdirSync } from "node:fs";
import { Resvg } from "/Users/joepeterson/development/tezoshitcoin.xyz/node_modules/@resvg/resvg-js/index.js";

mkdirSync("/tmp/logo", { recursive: true });
const png = (svg: string, w: number) =>
    new Resvg(svg, { fitTo: { mode: "width", value: w } }).render().asPng();

for (const seed of process.argv.slice(2)) {
    const full = renderLogo({ seed, size: 400, stroke: "#d9b46a", background: "#0f1b1a" });
    const compact = renderLogo({
        seed,
        size: 400,
        stroke: "#d9b46a",
        background: "#0f1b1a",
        detail: "compact",
    });
    writeFileSync(`/tmp/logo/${seed}.png`, png(full, 400));
    writeFileSync(`/tmp/logo/${seed}-c32.png`, png(compact, 32));
    writeFileSync(`/tmp/logo/${seed}-f32.png`, png(full, 32));
    console.log(`${seed}: full ${full.length}b, compact ${compact.length}b`);
}
