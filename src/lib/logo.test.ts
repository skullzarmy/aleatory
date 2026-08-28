/**
 * The mark, checked for the things that make it disappear.
 *
 * Element ids are document-wide. The mark builds its symmetry from one path
 * per band and a `<use>` for each rotation, so two marks on a page that name
 * their bands the same way collide: the second one's uses resolve to the first
 * one's paths, because getElementById returns the first match in the document.
 *
 * That happened the moment the header rendered two marks, one per breakpoint,
 * and it showed as a logo with most of itself missing.
 *
 * Run: npm test
 */

import { renderLogo } from "./logo";

let failures = 0;

function check(name: string, ok: boolean, detail?: string) {
    if (ok) {
        console.log(`  ok   ${name}`);
    } else {
        failures++;
        console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
    }
}

const idsIn = (svg: string) => [...svg.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
const refsIn = (svg: string) => [...svg.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);

console.log("\nThe mark\n");

// The header case: two marks, different seeds, same page.
{
    const a = renderLogo({ seed: "one", size: 44, detail: "full", label: "" });
    const b = renderLogo({ seed: "two", size: 72, detail: "full", label: "" });

    const A = new Set(idsIn(a));
    const B = new Set(idsIn(b));
    const shared = [...A].filter((id) => B.has(id));

    check(
        "two marks with different seeds share no element ids",
        shared.length === 0,
        `${shared.length} shared, starting ${shared[0] ?? ""}`,
    );

    for (const [name, svg, own] of [
        ["the first", a, A],
        ["the second", b, B],
    ] as const) {
        const dangling = refsIn(svg).filter((r) => !own.has(r));
        check(
            `${name} mark references only its own paths`,
            dangling.length === 0,
            `${dangling.length} dangling`,
        );
    }
}

// Same seed is a real case too: the server draws the canonical mark before the
// browser reseeds, and both marks are identical there, so a collision between
// them cannot show. It must still be deterministic.
{
    const a = renderLogo({ seed: "same", size: 40, detail: "full", label: "" });
    const b = renderLogo({ seed: "same", size: 40, detail: "full", label: "" });
    check("the same seed draws the same mark", a === b);
}

// A mark that defines bands and never uses them is a mark that draws nothing.
{
    const svg = renderLogo({ seed: "any", size: 72, detail: "full", label: "" });
    const ids = idsIn(svg);
    const refs = new Set(refsIn(svg));
    const unused = ids.filter((id) => !refs.has(id));
    check("every defined band is drawn", unused.length === 0, `${unused.length} unused`);
    check("the mark has bands at all", ids.length > 0);
}

console.log(
    failures === 0 ? "\nThe mark holds together.\n" : `\n${failures} check(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
