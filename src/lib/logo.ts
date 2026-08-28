/**
 * The mark, generated.
 *
 * A mandala of twelve-fold symmetry drawn from a seed. Identity is fixed and
 * the interior varies: the silhouette, the ring structure, the symmetry order
 * and the A at centre are the same every time, so the thing is recognisable
 * at sixteen pixels, and the tracery between the rings is what the seed
 * decides.
 *
 * Written against the same surface artists get. Pass `$alea.random` in and
 * the logo is a piece from Aleatory's own system, which means the harness
 * breaks on our homepage before it breaks on anyone's work.
 */

export interface LogoOptions {
    /** Anything. The same string gives the same mark, always. */
    seed?: string;
    size?: number;
    /** Line colour. Defaults to currentColor so it themes itself. */
    stroke?: string;
    /** Optional plate behind the tracery. */
    background?: string;
    /** Petals, spokes, and every repeat. Twelve is the mark. */
    fold?: number;
    /**
     * How much tracery to draw.
     *
     * `full` is the mark. `compact` keeps the silhouette, the frame and the
     * A, and drops the interior, because at favicon sizes detail turns to
     * mush and the silhouette is what carries recognition.
     */
    detail?: "full" | "compact";
    /**
     * Accessible name. An empty string marks the mark decorative, which is
     * right when it sits beside the word it stands for.
     */
    label?: string;
}

/* ------------------------------------------------------------------ */
/* Seeded stream, matching netlify/functions/lib/render.mts so the two agree exactly.  */
/* ------------------------------------------------------------------ */

function xmur3(str: string) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
        h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
        h = (h << 13) | (h >>> 19);
    }
    return () => {
        h = Math.imul(h ^ (h >>> 16), 2246822507);
        h = Math.imul(h ^ (h >>> 13), 3266489909);
        h ^= h >>> 16;
        return h >>> 0;
    };
}

function sfc32(a: number, b: number, c: number, d: number) {
    return () => {
        a >>>= 0;
        b >>>= 0;
        c >>>= 0;
        d >>>= 0;
        let t = (a + b) | 0;
        a = b ^ (b >>> 9);
        b = (c + (c << 3)) | 0;
        c = (c << 21) | (c >>> 11);
        d = (d + 1) | 0;
        t = (t + d) | 0;
        c = (c + t) | 0;
        return (t >>> 0) / 4294967296;
    };
}

export function makeRandom(seed: string): () => number {
    const s = xmur3(seed);
    return sfc32(s(), s(), s(), s());
}

/* ------------------------------------------------------------------ */
/* Geometry                                                            */
/* ------------------------------------------------------------------ */

const TAU = Math.PI * 2;

/** Polar to cartesian, rounded so the output is compact and stable. */
function pt(r: number, a: number): [number, number] {
    return [round(r * Math.cos(a)), round(r * Math.sin(a))];
}

function round(n: number): number {
    return Math.round(n * 100) / 100;
}

function pick<T>(rand: () => number, xs: readonly T[]): T {
    return xs[Math.floor(rand() * xs.length)];
}

function range(rand: () => number, lo: number, hi: number): number {
    return lo + rand() * (hi - lo);
}

/**
 * A petal: two arcs from the inner radius out to a point.
 *
 * `belly` bows the sides. Low values give a blade, high values a lotus leaf.
 */
function petal(r0: number, r1: number, halfAngle: number, belly: number): string {
    const [ax, ay] = pt(r0, -Math.PI / 2 - halfAngle);
    const [bx, by] = pt(r1, -Math.PI / 2);
    const [cx, cy] = pt(r0, -Math.PI / 2 + halfAngle);
    const mid = (r0 + r1) / 2;
    const [c1x, c1y] = pt(mid * belly, -Math.PI / 2 - halfAngle * 0.9);
    const [c2x, c2y] = pt(mid * belly, -Math.PI / 2 + halfAngle * 0.9);
    return `M${ax},${ay}Q${c1x},${c1y} ${bx},${by}Q${c2x},${c2y} ${cx},${cy}`;
}

/** A star polygon {n/step}, drawn as one closed path. */
function starPolygon(r: number, n: number, step: number, phase = 0): string {
    const seen = new Set<number>();
    const parts: string[] = [];
    for (let start = 0; start < n; start++) {
        if (seen.has(start)) continue;
        const loop: string[] = [];
        let i = start;
        do {
            seen.add(i);
            const [x, y] = pt(r, phase - Math.PI / 2 + (TAU * i) / n);
            loop.push(`${loop.length === 0 ? "M" : "L"}${x},${y}`);
            i = (i + step) % n;
        } while (i !== start);
        parts.push(loop.join("") + "Z");
    }
    return parts.join("");
}

/** An arc between two angles at one radius. */
function arc(r: number, a0: number, a1: number, sweep = 1): string {
    const [x0, y0] = pt(r, a0);
    const [x1, y1] = pt(r, a1);
    const large = Math.abs(a1 - a0) > Math.PI ? 1 : 0;
    return `M${x0},${y0}A${r},${r} 0 ${large} ${sweep} ${x1},${y1}`;
}

/**
 * The A.
 *
 * Two legs, a crossbar, and a bowl on the right that closes back into the
 * apex. Fixed geometry: this is the part that has to read the same forever.
 */
/**
 * The A.
 *
 * Two splayed legs and a crossbar, and the crossbar lands exactly on the
 * legs: its ends are solved from the leg geometry rather than guessed, so
 * there is no overhang at any size.
 *
 * The letter stays plain on purpose. The ring around it is ornate, and two
 * ornate things at the same centre fight each other.
 */
function monogram(r: number, style: MonogramStyle = "plain"): string {
    const h = r * 1.6;
    const w = r * 1.28;
    const apexY = -h / 2;
    const footY = h / 2;
    const halfW = w / 2;

    /** Half-width of the letter at a given height. */
    const widthAt = (y: number) => ((y - apexY) / h) * halfW;

    const barY = h * 0.2;
    const barX = widthAt(barY);

    const strokes = [
        `M0,${round(apexY)}L${round(-halfW)},${round(footY)}`,
        `M0,${round(apexY)}L${round(halfW)},${round(footY)}`,
        `M${round(-barX)},${round(barY)}L${round(barX)},${round(barY)}`,
    ];

    if (style === "hooked") {
        // The right leg carries on past the foot and curls back under, a nod
        // to the flourish in the original drawing. It reads as one stroke
        // continuing rather than a second shape stuck on.
        const hookR = w * 0.26;
        strokes[1] =
            `M0,${round(apexY)}L${round(halfW)},${round(footY)}` +
            `a${round(hookR)},${round(hookR)} 0 0 1 ${round(-hookR * 1.5)},${round(hookR * 0.35)}`;
    }

    return strokes.join("");
}

type MonogramStyle = "plain" | "hooked";

/* ------------------------------------------------------------------ */
/* The mark                                                            */
/* ------------------------------------------------------------------ */

interface Stroke {
    d: string;
    width: number;
    opacity: number;
    /** Repeated around the fold. */
    repeat: boolean;
    /** Extra rotation before repeating, in radians. */
    phase?: number;
}

/**
 * A mandala is concentric bands, and legibility comes from keeping them
 * apart. Each band owns a radius range, draws one motif inside it, and never
 * crosses into its neighbours. The seed picks which motif each band gets.
 *
 * Radii are fractions of the outer radius.
 */
const BANDS = {
    core: [0, 0.3],
    frame: [0.3, 0.34],
    inner: [0.34, 0.56],
    divider: [0.56, 0.6],
    petals: [0.6, 1],
} as const;

/** Circle centred on the origin, as one path. */
function circle(r: number): string {
    const rr = round(r);
    return `M${round(-r)},0a${rr},${rr} 0 1 0 ${round(r * 2)},0a${rr},${rr} 0 1 0 ${round(-r * 2)},0`;
}

/** Regular polygon. */
function polygon(r: number, n: number, phase = 0): string {
    const parts: string[] = [];
    for (let i = 0; i < n; i++) {
        const [x, y] = pt(r, phase - Math.PI / 2 + (TAU * i) / n);
        parts.push(`${i === 0 ? "M" : "L"}${x},${y}`);
    }
    return parts.join("") + "Z";
}

/**
 * Motifs for the band between the centre frame and the petals.
 *
 * Each one is drawn in a single wedge and repeated, so it tiles the ring
 * exactly however many times the fold says.
 */
function innerMotif(
    rand: () => number,
    fold: number,
    r0: number,
    r1: number,
): Stroke[] {
    const step = TAU / fold;
    const up = -Math.PI / 2;
    const mid = (r0 + r1) / 2;

    switch (pick(rand, ["rosette", "arcade", "lattice", "teardrop"] as const)) {
        // Overlapping circles, the classic. One per wedge, sized so
        // neighbours kiss rather than tangle.
        case "rosette": {
            const cr = ((r1 - r0) / 2) * range(rand, 0.85, 1);
            const [cx, cy] = pt(mid, up);
            return [
                {
                    d: `M${round(cx - cr)},${cy}a${round(cr)},${round(cr)} 0 1 0 ${round(cr * 2)},0a${round(cr)},${round(cr)} 0 1 0 ${round(-cr * 2)},0`,
                    width: 1.3,
                    opacity: 0.8,
                    repeat: true,
                },
            ];
        }

        // Arches springing between spokes, like an arcade seen head on.
        case "arcade": {
            const [ax, ay] = pt(r0, up - step / 2);
            const [bx, by] = pt(r0, up + step / 2);
            const [cx, cy] = pt(r1 * 1.02, up);
            return [
                {
                    d: `M${ax},${ay}Q${cx},${cy} ${bx},${by}`,
                    width: 1.4,
                    opacity: 0.85,
                    repeat: true,
                },
                {
                    d: `M${round(pt(r0, up - step / 2)[0])},${round(pt(r0, up - step / 2)[1])}L${round(pt(r1, up - step / 2)[0])},${round(pt(r1, up - step / 2)[1])}`,
                    width: 1,
                    opacity: 0.5,
                    repeat: true,
                },
            ];
        }

        // Crossing diagonals, which reads as woven at small sizes.
        case "lattice": {
            const [ax, ay] = pt(r0, up - step / 2);
            const [bx, by] = pt(r1, up + step / 2);
            const [cx, cy] = pt(r0, up + step / 2);
            const [dx, dy] = pt(r1, up - step / 2);
            return [
                { d: `M${ax},${ay}L${bx},${by}`, width: 1.1, opacity: 0.6, repeat: true },
                { d: `M${cx},${cy}L${dx},${dy}`, width: 1.1, opacity: 0.6, repeat: true },
            ];
        }

        // A small petal pointing inward, the mirror of the outer ring.
        default: {
            return [
                {
                    d: petal(r1, r0, step / 2.2, range(rand, 0.9, 1.1)),
                    width: 1.3,
                    opacity: 0.75,
                    repeat: true,
                },
            ];
        }
    }
}

/** The ring that separates the centre from everything else. */
function frameMotif(rand: () => number, fold: number, r: number): Stroke[] {
    switch (pick(rand, ["circle", "polygon", "star"] as const)) {
        case "circle":
            return [{ d: circle(r), width: 1.8, opacity: 0.9, repeat: false }];
        case "polygon":
            return [
                { d: polygon(r * 1.06, fold / 2), width: 1.6, opacity: 0.9, repeat: false },
            ];
        default:
            return [
                {
                    d: starPolygon(r * 1.08, fold, 5),
                    width: 1.2,
                    opacity: 0.7,
                    repeat: false,
                },
                { d: circle(r * 0.92), width: 1.4, opacity: 0.8, repeat: false },
            ];
    }
}

/**
 * The silhouette. Always petals, always reaching the outer radius, because
 * this is the part that has to be recognisable at sixteen pixels.
 */
function petalBand(
    rand: () => number,
    fold: number,
    r0: number,
    r1: number,
): Stroke[] {
    const step = TAU / fold;
    const belly = range(rand, 0.95, 1.15);
    const out: Stroke[] = [
        { d: petal(r0, r1, step / 2, belly), width: 1.6, opacity: 0.9, repeat: true },
    ];

    // A second, shorter layer offset by half a step, which is what gives the
    // ring depth without adding noise.
    if (rand() < 0.8) {
        out.push({
            d: petal(r0 * 0.94, r0 + (r1 - r0) * range(rand, 0.45, 0.62), step / 2.4, belly),
            width: 1.4,
            opacity: 0.5,
            repeat: true,
            phase: step / 2,
        });
    }

    // Scalloped edging strung between the tips.
    if (rand() < 0.6) {
        out.push({
            d: arc(r1 * 0.995, -Math.PI / 2 - step / 2, -Math.PI / 2 + step / 2, 1),
            width: 0.9,
            opacity: 0.4,
            repeat: true,
        });
    }

    return out;
}

function buildStrokes(
    rand: () => number,
    fold: number,
    R: number,
    detail: "full" | "compact",
): Stroke[] {
    const strokes: Stroke[] = [];

    if (detail === "compact") {
        // Silhouette, one frame ring, and the letter. Everything else is
        // noise below about forty pixels.
        strokes.push({
            d: circle(R * BANDS.frame[1] * 1.15),
            width: 2,
            opacity: 1,
            repeat: false,
        });
        const step = TAU / fold;
        strokes.push({
            d: petal(R * 0.58, R, step / 2, 1.05),
            width: 3,
            opacity: 1,
            repeat: true,
        });
        return strokes;
    }

    strokes.push(...frameMotif(rand, fold, R * BANDS.frame[1]));
    strokes.push(...innerMotif(rand, fold, R * BANDS.inner[0], R * BANDS.inner[1]));

    // The divider, always a plain circle. It is what stops the inner band
    // and the petals reading as one field.
    strokes.push({
        d: circle(R * BANDS.divider[0]),
        width: 1.2,
        opacity: 0.55,
        repeat: false,
    });

    strokes.push(...petalBand(rand, fold, R * BANDS.petals[0], R * BANDS.petals[1]));

    return strokes;
}

/**
 * An SVG string, ready to inline.
 *
 * Repeats are emitted as `<use>` against one definition, so symmetry is exact
 * by construction rather than by arithmetic done twelve times.
 */
export function renderLogo(options: LogoOptions = {}): string {
    const {
        seed = "aleatory",
        size = 512,
        stroke = "currentColor",
        background,
        fold = 12,
        detail = "full",
        label = "Aleatory",
    } = options;

    const rand = makeRandom(seed);

    // Element ids are document-wide, and a page may hold more than one mark.
    // Two logos both defining `s0` means the second one's `<use href="#s0">`
    // resolves to the first one's path, because getElementById returns the
    // first match in document order. The second mark then draws the first
    // mark's geometry where the ids happen to line up, and nothing at all
    // where they do not, which reads as a logo that has lost most of itself.
    //
    // Derived from the seed rather than a counter, so the server and the
    // browser produce the same markup. Two marks sharing a seed still collide,
    // and are identical, so the collision is invisible.
    const uid = xmur3(seed)().toString(36);
    const R = 100;
    const strokes = buildStrokes(rand, fold, R, detail);
    const step = TAU / fold;

    const defs: string[] = [];
    const uses: string[] = [];

    strokes.forEach((s0, i) => {
        const id = `${uid}s${i}`;
        defs.push(
            `<path id="${id}" d="${s0.d}" stroke-width="${s0.width}" opacity="${s0.opacity}"/>`,
        );
        if (s0.repeat) {
            for (let k = 0; k < fold; k++) {
                const deg = round(((step * k + (s0.phase ?? 0)) * 180) / Math.PI);
                uses.push(
                    deg === 0
                        ? `<use href="#${id}"/>`
                        : `<use href="#${id}" transform="rotate(${deg})"/>`,
                );
            }
        } else {
            uses.push(`<use href="#${id}"/>`);
        }
    });

    const plate = background
        ? `<circle cx="0" cy="0" r="${R * 1.04}" fill="${background}"/>`
        : "";

    // The centre is cleared before the monogram is drawn, so no tracery runs
    // behind the A. Without a plate colour the clear is skipped and the mark
    // stays a pure line drawing.
    const clear = background
        ? `<circle cx="0" cy="0" r="${round(R * BANDS.frame[0] * 0.98)}" fill="${background}"/>`
        : "";

    return [
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-108 -108 216 216" width="${size}" height="${size}" ` +
            (label ? `role="img" aria-label="${label}">` : `aria-hidden="true" focusable="false">`),
        `<defs>${defs.join("")}</defs>`,
        plate,
        `<g fill="none" stroke="${stroke}" stroke-linecap="round" stroke-linejoin="round">`,
        uses.join(""),
        `</g>`,
        clear,
        `<g fill="none" stroke="${stroke}" stroke-linecap="round" stroke-linejoin="round">`,
        `<path d="${monogram(R * (detail === "compact" ? 0.32 : 0.27))}" stroke-width="${detail === "compact" ? 6 : 4.6}"/>`,
        `</g>`,
        `</svg>`,
    ].join("");
}

/** The pinned mark. Favicons, OG cards, anywhere a file has to be forever. */
export const CANONICAL_SEED = "aleatory";
