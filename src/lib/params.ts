/**
 * Aleatory, mint-time parameters.
 *
 * A generator may declare up to five named inputs that whoever mints a piece
 * tunes before they sign. The declaration is the artist's: their names, their
 * ranges, their defaults. Nothing is imposed, and a generator that declares
 * nothing is the normal case, params are always optional.
 *
 * That is deliberately not what the previous generation of this idea did.
 * editart handed every project the same five unnamed sliders, so a parameter
 * meant whatever the artist could talk collectors into believing it meant. A
 * declared name with a declared range is legible on its own: a mint UI built by
 * someone who has never read our source can render the right control, and a
 * collector can see what they are actually turning.
 *
 * The piece stays a pure function of (code, seed, params). Two of those three
 * are chosen by a person, which is precisely why the third, resolution, has
 * to be mechanical: given a schema and any raw values at all, every renderer
 * anywhere must land on the same values, or the same token renders differently
 * in two places and the whole determinism guarantee is theatre.
 *
 * `resolveParams` below IS that rule, and docs/aleatory/params.md is its spec.
 */

/** Ceiling on declared params. Five is the most a collector will actually
 *  reason about before they stop reading and drag things at random. */
export const MAX_PARAMS = 5;

export type ParamType = "number" | "int" | "bool" | "color" | "select";

export interface ParamSpec {
    /** The key the code reads: `$alea.param("density")`. Stable forever. */
    id: string;
    /** What a collector sees on the control. */
    label: string;
    type: ParamType;
    /** number / int only. */
    min?: number;
    max?: number;
    /** number / int only. The quantization grid, values snap to it. */
    step?: number;
    /** select only. */
    options?: string[];
    /** Used when nothing is chosen, and when a value fails to resolve. */
    default: ParamValue;
    /** One line, shown under the control. Optional. */
    hint?: string;
}

export type ParamValue = number | boolean | string;
export type ParamValues = Record<string, ParamValue>;

export interface ParamsSchema {
    /** Layout of this declaration. Bumped only additively. */
    version: 1;
    params: ParamSpec[];
}

export const PARAMS_SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Declaring
// ---------------------------------------------------------------------------

const ID_RE = /^[a-z][a-z0-9_]{0,23}$/;
const HEX_RE = /^#[0-9a-f]{6}$/i;

export function emptySchema(): ParamsSchema {
    return { version: PARAMS_SCHEMA_VERSION, params: [] };
}

/** A fresh declaration with an id that does not collide. */
export function newParam(existing: ParamSpec[]): ParamSpec {
    const taken = new Set(existing.map((p) => p.id));
    let id = "param";
    for (let i = 1; taken.has(id); i++) id = `param${i}`;
    return { id, label: id, type: "number", min: 0, max: 1, step: 0.01, default: 0.5 };
}

/**
 * Everything wrong with a declaration, in the artist's terms.
 *
 * Validation runs in the studio and gates publishing, because a broken schema
 * is not recoverable after the fact: the record is immutable, and a mint UI
 * built from a contradictory declaration cannot be fixed by us later.
 */
export function validateSchema(params: ParamSpec[]): string[] {
    const errors: string[] = [];
    if (params.length > MAX_PARAMS) {
        errors.push(`At most ${MAX_PARAMS} parameters. Declared ${params.length}.`);
    }

    const seen = new Set<string>();
    for (const p of params) {
        const where = p.id || "(unnamed)";
        if (!ID_RE.test(p.id)) {
            errors.push(
                `"${where}" is not a usable name, lowercase letters, digits and _ only, starting with a letter, max 24.`,
            );
        }
        if (seen.has(p.id))
            errors.push(`"${where}" is declared twice. Names are how the code finds a value.`);
        seen.add(p.id);
        if (!p.label.trim())
            errors.push(`"${where}" needs a label, it is what a collector reads on the control.`);

        if (p.type === "number" || p.type === "int") {
            const min = p.min ?? 0;
            const max = p.max ?? 1;
            if (!Number.isFinite(min) || !Number.isFinite(max))
                errors.push(`"${where}" needs a numeric min and max.`);
            else if (min >= max)
                errors.push(`"${where}" has min ${min} ≥ max ${max}, there is nothing to tune.`);
            const step = p.step ?? (p.type === "int" ? 1 : 0.01);
            if (!(step > 0)) errors.push(`"${where}" needs a step greater than zero.`);
            else if (step > max - min)
                errors.push(
                    `"${where}" has a step larger than its range, it can only ever hold one value.`,
                );
            if (typeof p.default !== "number" || !Number.isFinite(p.default))
                errors.push(`"${where}" needs a numeric default.`);
            else if (p.default < min || p.default > max)
                errors.push(`"${where}" has a default of ${p.default}, outside ${min}…${max}.`);
        }

        if (p.type === "select") {
            const options = (p.options ?? []).filter((o) => o.trim().length > 0);
            if (options.length < 2)
                errors.push(`"${where}" is a choice with fewer than two options.`);
            if (new Set(options).size !== options.length)
                errors.push(`"${where}" repeats an option.`);
            if (typeof p.default !== "string" || !options.includes(p.default)) {
                errors.push(`"${where}" has a default that is not one of its options.`);
            }
        }

        if (p.type === "color" && (typeof p.default !== "string" || !HEX_RE.test(p.default))) {
            errors.push(`"${where}" needs a #rrggbb default.`);
        }

        if (p.type === "bool" && typeof p.default !== "boolean") {
            errors.push(`"${where}" needs a true/false default.`);
        }
    }

    return errors;
}

/** The schema as it goes into the record, null when nothing is declared, so
 *  "no params" stays one unambiguous shape rather than two. */
export function schemaForRecord(params: ParamSpec[]): ParamsSchema | null {
    if (params.length === 0) return null;
    return { version: PARAMS_SCHEMA_VERSION, params };
}

export function specsOf(schema: ParamsSchema | null | undefined): ParamSpec[] {
    return schema?.params ?? [];
}

// ---------------------------------------------------------------------------
// Resolving
// ---------------------------------------------------------------------------

/**
 * Snap a number onto the declared grid.
 *
 * Two runs of one token must produce identical values, and a float that arrives
 * as 0.30000000000000004 from one UI and 0.3 from another is the same slider in
 * two positions as far as the piece is concerned. Quantizing at resolution time
 *, not at control time, means it does not matter which UI produced it.
 */
function quantize(value: number, min: number, max: number, step: number): number {
    const clamped = Math.min(max, Math.max(min, value));
    const steps = Math.round((clamped - min) / step);
    const snapped = Math.min(max, min + steps * step);
    // Kill the binary-float tail the multiply reintroduces. 6 decimals is finer
    // than any control a person operates and survives a JSON round trip exactly.
    return Math.round(snapped * 1e6) / 1e6;
}

/** Resolve one raw value against its declaration. Never throws. */
export function resolveParam(spec: ParamSpec, raw: unknown): ParamValue {
    switch (spec.type) {
        case "number":
        case "int": {
            const min = spec.min ?? 0;
            const max = spec.max ?? 1;
            const step = spec.step ?? (spec.type === "int" ? 1 : 0.01);
            const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
            if (!Number.isFinite(n)) return spec.default;
            const q = quantize(n, min, max, step);
            return spec.type === "int" ? Math.round(q) : q;
        }
        case "bool": {
            if (typeof raw === "boolean") return raw;
            if (raw === "true") return true;
            if (raw === "false") return false;
            return spec.default;
        }
        case "color": {
            if (typeof raw === "string" && HEX_RE.test(raw)) return raw.toLowerCase();
            return spec.default;
        }
        case "select": {
            const options = spec.options ?? [];
            if (typeof raw === "string" && options.includes(raw)) return raw;
            return spec.default;
        }
        default:
            return spec.default;
    }
}

/**
 * Schema + anything at all in → the values the piece will actually see.
 *
 * Every path into a render goes through here: the studio tuner, the mint form,
 * the gallery reading values back off a token, and any third-party renderer
 * following params.md. A value that arrives out of range or of the wrong type
 * is corrected, never rejected, the alternative is a token that some viewers
 * can render and others cannot, which is the one outcome worth designing out.
 */
export function resolveParams(
    specs: ParamSpec[],
    // Values, never the JSON they were written as. A string here used to
    // compile, match none of the branches below, and return every declared
    // default: a plausible-looking set of values that nobody chose. That is
    // `decodeParams`, one door down, and this signature is what makes taking
    // the wrong one a build error rather than a wrong picture.
    raw: Record<string, unknown> | null | undefined,
): ParamValues {
    const source = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const out: ParamValues = {};
    // Declaration order, not input order: the encoding below is canonical, and
    // two encodings of the same values must be byte-identical.
    for (const spec of specs) out[spec.id] = resolveParam(spec, source[spec.id]);
    return out;
}

export function defaultValues(specs: ParamSpec[]): ParamValues {
    const out: ParamValues = {};
    for (const spec of specs) out[spec.id] = resolveParam(spec, spec.default);
    return out;
}

/** A value picked uniformly at random within the declaration, the "surprise
 *  me" the mint UI offers, and how the grid shows off a parameter's range. */
export function randomValues(specs: ParamSpec[], rand: () => number = Math.random): ParamValues {
    const out: ParamValues = {};
    for (const spec of specs) {
        switch (spec.type) {
            case "number":
            case "int": {
                const min = spec.min ?? 0;
                const max = spec.max ?? 1;
                out[spec.id] = resolveParam(spec, min + rand() * (max - min));
                break;
            }
            case "bool":
                out[spec.id] = rand() < 0.5;
                break;
            case "select": {
                const options = spec.options ?? [];
                out[spec.id] =
                    options.length > 0
                        ? options[Math.floor(rand() * options.length)]
                        : spec.default;
                break;
            }
            case "color": {
                const hex = Math.floor(rand() * 0xffffff)
                    .toString(16)
                    .padStart(6, "0");
                out[spec.id] = `#${hex}`;
                break;
            }
            default:
                out[spec.id] = spec.default;
        }
    }
    return out;
}

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

/**
 * The canonical on-chain form: JSON, keys in declaration order, values already
 * resolved. Written into token_info as `aleaParams`.
 *
 * Canonical because it is quoted in provenance and compared across renderers.
 * Declaration order rather than sorted order because the declaration is the
 * only ordering a third party can reconstruct without our code.
 */
export function encodeParams(specs: ParamSpec[], values: ParamValues): string {
    const resolved = resolveParams(specs, values);
    const parts = specs.map(
        (spec) => `${JSON.stringify(spec.id)}:${JSON.stringify(resolved[spec.id])}`,
    );
    return `{${parts.join(",")}}`;
}

/** Read `aleaParams` back off a token. Bad JSON resolves to defaults rather
 *  than failing the render, the schema is the authority, not the token. */
export function decodeParams(specs: ParamSpec[], json: string | null | undefined): ParamValues {
    if (!json) return defaultValues(specs);
    try {
        return resolveParams(specs, JSON.parse(json));
    } catch {
        return defaultValues(specs);
    }
}

// ---------------------------------------------------------------------------
// Importing an fxhash-era declaration
// ---------------------------------------------------------------------------

/**
 * Map an `$fx.params([...])` declaration onto ours.
 *
 * Nothing stranded is a promise about whole projects, and a project whose
 * controls have to be re-typed by hand is only most of the way home. The shapes
 * are close enough that this is mechanical: `name` becomes `label`, the nested
 * `options` object flattens, and `bigint` lands as an int.
 *
 * Two honest losses, reported rather than silently absorbed: fxhash string
 * params have no equivalent here (a free-text input is not a dimension of a
 * piece, it is a caption), and anything past the fifth declaration is dropped.
 */
export function fromFxParams(definition: unknown): { params: ParamSpec[]; notes: string[] } {
    const list = Array.isArray(definition) ? definition : [];
    const params: ParamSpec[] = [];
    const notes: string[] = [];

    for (const entry of list) {
        const d = (entry ?? {}) as Record<string, unknown>;
        const id =
            String(d.id ?? "")
                .toLowerCase()
                .replace(/[^a-z0-9_]/g, "_")
                .replace(/^[^a-z]+/, "") || `param${params.length + 1}`;
        const label = String(d.name ?? d.id ?? id);
        const options = (d.options ?? {}) as Record<string, unknown>;
        const num = (v: unknown, fallback: number) =>
            Number.isFinite(Number(v)) ? Number(v) : fallback;

        switch (String(d.type ?? "number")) {
            case "number":
            case "bigint": {
                const isInt = d.type === "bigint";
                const min = num(options.min, 0);
                const max = num(options.max, isInt ? 100 : 1);
                const step = num(options.step, isInt ? 1 : 0.01);
                const fallbackDefault = min + (max - min) / 2;
                const spec: ParamSpec = {
                    id,
                    label,
                    type: isInt ? "int" : "number",
                    min,
                    max,
                    step,
                    default: fallbackDefault,
                };
                const resolved = resolveParam(spec, d.default);
                // Said out loud, like every other loss here. A default is the
                // position a collector finds the control in, and the schema is
                // immutable once the collection exists, so a default that moved
                // is worth one line now and worth nothing afterwards.
                if (
                    typeof d.default === "number" &&
                    Number.isFinite(d.default) &&
                    (d.default < min || d.default > max)
                ) {
                    notes.push(
                        `"${label}" declared a default of ${d.default}, outside ${min}…${max}. It starts at ${resolved}.`,
                    );
                }
                params.push({ ...spec, default: resolved });
                break;
            }
            case "boolean":
                params.push({ id, label, type: "bool", default: d.default === true });
                break;
            case "color": {
                // fxhash colors are hex8 without a leading #; alpha has no meaning
                // in a declaration a collector reads, so it is dropped.
                const raw = String(d.default ?? "000000")
                    .replace(/^#/, "")
                    .slice(0, 6)
                    .padEnd(6, "0");
                params.push({ id, label, type: "color", default: `#${raw.toLowerCase()}` });
                break;
            }
            case "select": {
                const choices = (Array.isArray(options.options) ? options.options : []).map(String);
                if (choices.length < 2) {
                    notes.push(`"${label}" is a select with fewer than two options, skipped.`);
                    break;
                }
                const chosen = choices.includes(String(d.default)) ? String(d.default) : choices[0];
                if (d.default !== undefined && chosen !== String(d.default)) {
                    notes.push(
                        `"${label}" declared a default of "${String(d.default)}", which is not one of its options. It starts at "${chosen}".`,
                    );
                }
                params.push({ id, label, type: "select", options: choices, default: chosen });
                break;
            }
            default:
                notes.push(
                    `"${label}" is a ${String(d.type)} param, which has no equivalent here, skipped.`,
                );
        }
    }

    if (params.length > MAX_PARAMS) {
        notes.push(`Kept the first ${MAX_PARAMS} of ${params.length} declared params.`);
        params.length = MAX_PARAMS;
    }
    return { params, notes };
}

/** How a value reads in a summary line. */
export function formatParamValue(spec: ParamSpec, value: ParamValue): string {
    if (spec.type === "bool") return value ? "on" : "off";
    return String(value);
}

/** One-line human summary of a whole set, for token descriptions and lists. */
export function summarizeParams(specs: ParamSpec[], values: ParamValues): string {
    return specs
        .map((spec) => `${spec.label}: ${formatParamValue(spec, values[spec.id])}`)
        .join(" · ");
}
