/**
 * Aleatory, starter templates.
 *
 * One per runtime kind. Each is a complete, single-file index.html that also
 * runs by being opened directly from disk: the `$alea` guard at the top provides
 * a local dev harness with a random seed when the real one isn't there. That
 * is the loop artists actually live in, reload for a new seed, pin one by URL
 * (?seed=…), and it means nothing about working locally depends on us.
 */
import type { ParamSpec } from "./params";
import { RUNTIME_KINDS } from "./runtimes";

/** The dev-harness guard prepended to every template. */
/**
 * The templates themselves live in `public/templates/<kind>/index.html`.
 *
 * They used to be backtick literals in this file, where nobody could find
 * them and where one stray backtick inside somebody's template ended the
 * string and broke the module. As files they are readable on GitHub,
 * downloadable, and openable straight from disk: each carries the dev harness
 * inline, so opening one in a browser draws it with a random seed.
 *
 * `npm run templates:build` regenerates the import below from those files and
 * runs before every build, so the two cannot drift.
 */
import { TEMPLATE_HTML } from "./templates.generated";

const PARAMS_BY_KIND: Record<string, ParamSpec[]> = {
    vanilla: [
        {
            id: "density",
            label: "Density",
            type: "int",
            min: 40,
            max: 320,
            step: 10,
            default: 140,
            hint: "How many marks are drawn.",
        },
        {
            id: "spread",
            label: "Spread",
            type: "number",
            min: 0.05,
            max: 0.5,
            step: 0.01,
            default: 0.35,
            hint: "How far marks wander from the ring.",
        },
    ],
    svg: [
        {
            id: "ink",
            label: "Ink",
            type: "select",
            options: ["black", "red", "blue", "amber", "green"],
            default: "black",
            hint: "The single colour every line is drawn in.",
        },
        {
            id: "grain",
            label: "Grain",
            type: "number",
            min: 0.03,
            max: 0.16,
            step: 0.005,
            default: 0.08,
            hint: "Smaller subdivides further.",
        },
    ],
    p5: [
        { id: "count", label: "Lines", type: "int", min: 200, max: 1600, step: 50, default: 800 },
        {
            id: "flow",
            label: "Turbulence",
            type: "number",
            min: 0.001,
            max: 0.01,
            step: 0.0005,
            default: 0.004,
        },
    ],
    custom: [
        { id: "bars", label: "Bars", type: "int", min: 4, max: 48, step: 1, default: 18 },
        {
            id: "chroma",
            label: "Chroma",
            type: "number",
            min: 0,
            max: 1,
            step: 0.01,
            default: 0.6,
            hint: "0 is grey, 1 is fully saturated.",
        },
    ],
};

export function templateFor(kindId: number): string {
    const kind = RUNTIME_KINDS.find((k) => k.kindId === kindId);
    return TEMPLATE_HTML[kind?.name ?? "vanilla"] ?? TEMPLATE_HTML.vanilla;
}

export function templateParamsFor(kindId: number): ParamSpec[] {
    const kind = RUNTIME_KINDS.find((k) => k.kindId === kindId);
    // Copied, not shared: the panel edits these in place.
    return (PARAMS_BY_KIND[kind?.name ?? "vanilla"] ?? []).map((p) => ({
        ...p,
        options: p.options ? [...p.options] : undefined,
    }));
}
