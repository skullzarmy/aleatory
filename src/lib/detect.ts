import { declaredIn } from "./libraries";
import { RUNTIME_KINDS } from "./kinds";
import { fromFxParams, MAX_PARAMS, type ParamSpec, resolveParam, validateSchema } from "./params";

/**
 * Which runtime kind a generator was written against, read from the generator.
 *
 * Guessing is safe here. Libraries load from the `alea:library` tags and not
 * from the kind, so a mislabelled piece still renders, and the caller shows
 * what was detected instead of applying it silently.
 */

export interface Detection {
    kindId: number;
    /** What in the file gave it away, for showing to the artist. */
    because: string;
    /** False when nothing matched and the fallback was used. */
    certain: boolean;
}

export interface ParamsDetection {
    params: ParamSpec[];
    because: string;
    /** What reading the declaration cost, for showing to the artist. */
    notes: string[];
}

const idOf = (name: string) =>
    RUNTIME_KINDS.find((k) => k.name === name)?.kindId ?? RUNTIME_KINDS[0].kindId;

export function detectKind(html: string): Detection {
    const declared = declaredIn(html);

    // Assignment, not mention: the dev harness in every template reads
    // window.ALEA_MAIN, so naming it says nothing about the kind.
    if (/\bALEA_MAIN\s*=[^=]/.test(html)) {
        return {
            kindId: idOf("custom"),
            because: "it exports ALEA_MAIN, the custom runtime lifecycle",
            certain: true,
        };
    }

    const p5 = declared.find((c) => /^p5@/.test(c));
    if (p5) {
        return { kindId: idOf("p5"), because: `it declares ${p5}`, certain: true };
    }

    if (declared.length > 0) {
        return {
            kindId: idOf("custom"),
            because: `it declares ${declared.join(", ")}`,
            certain: true,
        };
    }

    // The element being built, not mentioned, so a comment about SVG in a
    // canvas piece does not decide this.
    if (
        /createElementNS\s*\(\s*["']http:\/\/www\.w3\.org\/2000\/svg/.test(html) ||
        /<svg\b/i.test(html)
    ) {
        return { kindId: idOf("svg"), because: "it builds an <svg>", certain: true };
    }

    if (/getContext\s*\(\s*["']2d["']/.test(html) || /<canvas\b/i.test(html)) {
        return { kindId: idOf("vanilla"), because: "it draws to a canvas", certain: true };
    }

    return {
        kindId: idOf("vanilla"),
        because: "nothing in the file identified it, so this is a guess",
        certain: false,
    };
}

/**
 * The array literal starting at `open`, found by counting brackets. Strings and
 * comments are tracked, because a `]` inside either one closes nothing.
 */
function arrayLiteralAt(source: string, open: number): string | null {
    let depth = 0;
    let quote: string | null = null;
    let escaped = false;

    for (let i = open; i < source.length; i++) {
        const char = source[i];

        if (quote) {
            if (escaped) escaped = false;
            else if (char === "\\") escaped = true;
            else if (char === quote) quote = null;
            continue;
        }

        if (char === '"' || char === "'" || char === "`") {
            quote = char;
            continue;
        }
        if (char === "/" && source[i + 1] === "/") {
            const line = source.indexOf("\n", i);
            if (line === -1) return null;
            i = line;
            continue;
        }
        if (char === "/" && source[i + 1] === "*") {
            const end = source.indexOf("*/", i + 2);
            if (end === -1) return null;
            i = end + 1;
            continue;
        }

        if (char === "[") depth++;
        else if (char === "]" && --depth === 0) return source.slice(open, i + 1);
    }
    return null;
}

type Literal = null | boolean | number | string | Literal[] | { [key: string]: Literal };

/** Returned instead of a value when the source is not a literal at all. */
const NOT_LITERAL = Symbol("not a literal");

const NUMBER = /^[+-]?(?:0[xX][0-9a-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/;
const KEYWORD = /^(?:true|false|null)\b/;
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*/;

/**
 * Read a JavaScript literal without running it.
 *
 * These bytes came out of an uploaded file. `eval` or `new Function` would run
 * a stranger's code on this origin, beside the artist's wallet session and
 * their drafts; generator code runs in the isolate and nowhere else.
 *
 * `JSON.parse` is not enough, because generators declare object literals with
 * unquoted keys, single quotes, trailing commas and comments. This reads that
 * subset only. Anything built by a call, an identifier or an operator returns
 * NOT_LITERAL.
 */
function parseLiteral(source: string): Literal | typeof NOT_LITERAL {
    let at = 0;

    function skip(): void {
        for (;;) {
            while (at < source.length && /\s/.test(source[at])) at++;
            if (source[at] === "/" && source[at + 1] === "/") {
                const line = source.indexOf("\n", at);
                at = line === -1 ? source.length : line + 1;
            } else if (source[at] === "/" && source[at + 1] === "*") {
                const end = source.indexOf("*/", at + 2);
                at = end === -1 ? source.length : end + 2;
            } else return;
        }
    }

    function readString(): string | typeof NOT_LITERAL {
        const quote = source[at++];
        let out = "";
        while (at < source.length) {
            const char = source[at];
            if (char === "\\") {
                const escape = source[at + 1];
                at += 2;
                if (escape === "u") {
                    const brace = source[at] === "{";
                    const hex = brace
                        ? /^\{([0-9a-fA-F]{1,6})\}/.exec(source.slice(at))
                        : /^([0-9a-fA-F]{4})/.exec(source.slice(at));
                    if (!hex) return NOT_LITERAL;
                    at += hex[0].length;
                    out += String.fromCodePoint(parseInt(hex[1], 16));
                } else if (escape === "x") {
                    const hex = /^([0-9a-fA-F]{2})/.exec(source.slice(at));
                    if (!hex) return NOT_LITERAL;
                    at += 2;
                    out += String.fromCharCode(parseInt(hex[1], 16));
                } else if (escape === "\n") {
                    // A line continuation contributes nothing.
                } else {
                    out += ESCAPES[escape] ?? escape ?? "";
                }
                continue;
            }
            // A template with a substitution in it is computed, not declared.
            if (quote === "`" && char === "$" && source[at + 1] === "{") return NOT_LITERAL;
            if (char === quote) {
                at++;
                return out;
            }
            out += char;
            at++;
        }
        return NOT_LITERAL;
    }

    function readArray(): Literal | typeof NOT_LITERAL {
        at++;
        const out: Literal[] = [];
        for (;;) {
            skip();
            if (source[at] === "]") {
                at++;
                return out;
            }
            if (at >= source.length) return NOT_LITERAL;
            const value = readValue();
            if (value === NOT_LITERAL) return NOT_LITERAL;
            out.push(value);
            skip();
            if (source[at] === ",") at++;
            else if (source[at] !== "]") return NOT_LITERAL;
        }
    }

    function readObject(): Literal | typeof NOT_LITERAL {
        at++;
        const out: Record<string, Literal> = {};
        for (;;) {
            skip();
            if (source[at] === "}") {
                at++;
                return out;
            }
            if (at >= source.length) return NOT_LITERAL;

            const char = source[at];
            let key: string | typeof NOT_LITERAL;
            if (char === '"' || char === "'" || char === "`") {
                key = readString();
            } else {
                const name = IDENTIFIER.exec(source.slice(at));
                if (!name) return NOT_LITERAL;
                at += name[0].length;
                key = name[0];
            }
            if (key === NOT_LITERAL) return NOT_LITERAL;

            skip();
            if (source[at] !== ":") return NOT_LITERAL;
            at++;
            const value = readValue();
            if (value === NOT_LITERAL) return NOT_LITERAL;
            // Assigning `__proto__` out of an uploaded file would hand it the
            // prototype of every object downstream.
            if (key !== "__proto__") out[key] = value;

            skip();
            if (source[at] === ",") at++;
            else if (source[at] !== "}") return NOT_LITERAL;
        }
    }

    function readValue(): Literal | typeof NOT_LITERAL {
        skip();
        const char = source[at];
        if (char === undefined) return NOT_LITERAL;
        if (char === '"' || char === "'" || char === "`") return readString();
        if (char === "[") return readArray();
        if (char === "{") return readObject();

        const keyword = KEYWORD.exec(source.slice(at));
        if (keyword) {
            at += keyword[0].length;
            return keyword[0] === "null" ? null : keyword[0] === "true";
        }

        const number = NUMBER.exec(source.slice(at));
        if (!number) return NOT_LITERAL;
        at += number[0].length;
        const magnitude = Number(number[0].replace(/^[+-]/, ""));
        if (!Number.isFinite(magnitude)) return NOT_LITERAL;
        return number[0].startsWith("-") ? -magnitude : magnitude;
    }

    const value = readValue();
    skip();
    return at === source.length ? value : NOT_LITERAL;
}

const ESCAPES: Record<string, string> = {
    n: "\n",
    t: "\t",
    r: "\r",
    b: "\b",
    f: "\f",
    v: "\v",
    "0": "\0",
};

/**
 * The array literal from the last declaration matching `pattern`, or null when
 * no literal assignment matches.
 *
 * Last, because that is the one that wins at runtime. All four starter kits
 * carry `window.$alea.paramsSchema = []` in their dev harness, so a file that
 * began as a template holds two assignments and the artist's is below. An empty
 * array from the last one is an answer: the generator runs with no parameters.
 *
 * A reassignment by reference (`= window.ALEA_PARAMS`) is not a literal and
 * never matches, so it does not shadow the literal it points at.
 */
function declaredArray(html: string, pattern: RegExp): unknown[] | null {
    const every = new RegExp(
        pattern.source,
        pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`,
    );
    let last: unknown[] | null = null;
    for (const match of html.matchAll(every)) {
        const open = html.indexOf("[", match.index);
        if (open === -1) continue;
        const raw = arrayLiteralAt(html, open);
        if (raw === null) continue;
        const value = parseLiteral(raw);
        if (Array.isArray(value)) last = value;
    }
    return last;
}

/** A declaration we could read, or the reason we could not. */
type Reading = { spec: ParamSpec; note?: string } | { dropped: string };

function normalizeRawParam(p: unknown, at: number): Reading {
    const where = `Parameter ${at + 1}`;
    if (!p || typeof p !== "object" || Array.isArray(p)) {
        return { dropped: `${where} is not a declaration, so it was dropped.` };
    }
    const obj = p as Record<string, unknown>;
    const given = String(obj.id ?? "").trim();
    const id = given
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, "_")
        .replace(/^[^a-z]+/, "");
    const label = String(obj.label ?? obj.id ?? id).trim();
    if (!id) {
        return {
            dropped: `${where} has no usable name, so it was dropped. The name is how the code finds a value.`,
        };
    }

    const hint = typeof obj.hint === "string" ? { hint: obj.hint } : {};
    const type = String(obj.type ?? "number");

    if (type === "int" || type === "number") {
        const isInt = type === "int";
        const min = typeof obj.min === "number" && Number.isFinite(obj.min) ? obj.min : 0;
        const max =
            typeof obj.max === "number" && Number.isFinite(obj.max) ? obj.max : isInt ? 100 : 1;
        const step =
            typeof obj.step === "number" && Number.isFinite(obj.step) ? obj.step : isInt ? 1 : 0.01;
        const spec: ParamSpec = {
            id,
            label: label || id,
            type: isInt ? "int" : "number",
            min,
            max,
            step,
            default: min,
            ...hint,
        };
        // The declared default goes through the same clamp every renderer uses,
        // and a move is reported, because a default is where a collector finds
        // the control and the schema is immutable once the collection exists.
        // The snap onto the step grid is not reported: it moves a value by less
        // than the control can hold.
        const resolved = resolveParam(spec, obj.default);
        const declared = obj.default;
        let note: string | undefined = undefined;
        if (typeof declared === "number" && Number.isFinite(declared)) {
            if (declared < min || declared > max) {
                note = `"${label || id}" declared a default of ${declared}, outside ${min}…${max}. It starts at ${resolved}.`;
            }
        } else if (declared !== undefined) {
            note = `"${label || id}" declared a default that is not a number. It starts at ${resolved}.`;
        }
        return { spec: { ...spec, default: resolved }, ...(note ? { note } : {}) };
    }
    if (type === "bool") {
        return {
            spec: { id, label: label || id, type: "bool", default: obj.default === true, ...hint },
        };
    }
    if (type === "color") {
        const raw = String(obj.default ?? "#000000").trim();
        const hex = raw.startsWith("#") ? raw : `#${raw}`;
        return {
            spec: {
                id,
                label: label || id,
                type: "color",
                default: /^#[0-9a-f]{6}$/i.test(hex) ? hex.toLowerCase() : "#000000",
                ...hint,
            },
        };
    }
    if (type === "select") {
        const options = Array.isArray(obj.options) ? obj.options.map(String).filter(Boolean) : [];
        if (options.length < 2) {
            return {
                dropped: `"${label || id}" is a choice with fewer than two options, so it was dropped.`,
            };
        }
        const value =
            typeof obj.default === "string" && options.includes(obj.default)
                ? obj.default
                : options[0];
        return {
            spec: { id, label: label || id, type: "select", options, default: value, ...hint },
        };
    }
    return {
        dropped: `"${label || id}" is a ${type} parameter, which has no equivalent here, so it was dropped.`,
    };
}

/**
 * What survives of a raw declaration, or null if none of it does.
 *
 * Judged one parameter at a time, so a typo in the fifth costs the fifth.
 * `validateSchema` answers about a whole set, which is the studio's gate and
 * the wrong shape here.
 *
 * Nothing is renamed to make it fit: an id is what the code reads back with
 * `$alea.param("density")`, so a repaired one tunes nothing. Every loss goes
 * out in `notes`.
 */
function detected(
    readings: Reading[],
    because: string,
    notes: string[] = [],
): ParamsDetection | null {
    const params: ParamSpec[] = [];
    const lost = [...notes];
    const taken = new Set<string>();
    let over = 0;

    for (const reading of readings) {
        if ("dropped" in reading) {
            lost.push(reading.dropped);
            continue;
        }
        const { spec } = reading;
        if (taken.has(spec.id)) {
            lost.push(
                `"${spec.id}" is declared twice, so the second was dropped. Names are how the code finds a value.`,
            );
            continue;
        }
        const wrong = validateSchema([spec]);
        if (wrong.length > 0) {
            lost.push(`${wrong[0]} Dropped.`);
            continue;
        }
        if (params.length === MAX_PARAMS) {
            over++;
            continue;
        }
        taken.add(spec.id);
        params.push(spec);
        if (reading.note) lost.push(reading.note);
    }

    if (over > 0) {
        lost.push(
            `Kept the first ${MAX_PARAMS} of the ${MAX_PARAMS + over} readable, the rest were dropped.`,
        );
    }
    if (params.length === 0) return null;
    return { params, because, notes: lost };
}

const ENTITIES: Record<string, string> = {
    "&quot;": '"',
    "&apos;": "'",
    "&#34;": '"',
    "&#39;": "'",
    "&lt;": "<",
    "&gt;": ">",
    "&amp;": "&",
};

/** An attribute's real text. JSON in an attribute escapes one quote or the other. */
function unescapeAttribute(value: string): string {
    return value.replace(/&(?:quot|apos|#34|#39|lt|gt|amp);/g, (e) => ENTITIES[e] ?? e);
}

/**
 * Read the parameters a generator declares about itself. A generator that
 * declares nothing gets its kind's defaults.
 *
 * In the order tried:
 * 1. `<meta name="alea:params" content="…">`, an explicit declaration in JSON
 * 2. `window.$alea.paramsSchema = [...]`, ours, the one the templates write
 * 3. `ALEA_PARAMS = [...]`, the same list under its own name
 * 4. `$fx.params([...])`, so an fxhash piece arrives with its controls intact
 */
export function detectParams(html: string): ParamsDetection | null {
    const meta =
        html.match(
            /<meta\s+[^>]*name=["'](?:alea|aleatory):params["'][^>]*content=(["'])([\s\S]*?)\1/i,
        ) ??
        html.match(
            /<meta\s+[^>]*content=(["'])([\s\S]*?)\1[^>]*name=["'](?:alea|aleatory):params["']/i,
        );
    if (meta) {
        try {
            const parsed: unknown = JSON.parse(unescapeAttribute(meta[2]));
            const list = Array.isArray(parsed)
                ? parsed
                : (parsed as { params?: unknown[] })?.params;
            if (Array.isArray(list)) {
                const found = detected(
                    list.map(normalizeRawParam),
                    "it declares params in a meta tag",
                );
                if (found) return found;
            }
        } catch {
            // Not JSON. The code below may still say it properly.
        }
    }

    const schema = declaredArray(html, /(?:window\.)?\$alea\.paramsSchema\s*=\s*\[/);
    if (schema) {
        const found = detected(
            schema.map(normalizeRawParam),
            "it declares $alea.paramsSchema in code",
        );
        if (found) return found;
    }

    const named = declaredArray(html, /(?:window\.)?ALEA_PARAMS\s*=\s*\[/);
    if (named) {
        const found = detected(named.map(normalizeRawParam), "it declares ALEA_PARAMS in code");
        if (found) return found;
    }

    const fx = declaredArray(html, /\$fx\.params\s*\(\s*\[/);
    if (fx) {
        // `fromFxParams` reports what it could not bring over, and those notes
        // are carried through.
        const converted = fromFxParams(fx);
        const found = detected(
            converted.params.map((spec) => ({ spec })),
            "it declares $fx.params, which came over from fxhash",
            converted.notes,
        );
        if (found) return found;
    }

    return null;
}

/**
 * Rewrite a document's parameter declaration to exactly these.
 *
 * ALEATORY-001 says a generator declares its own parameters, so the declaration
 * lives inside the artist's file and every parseable one is replaced by a
 * single block. Leaving an older one behind would leave the file saying two
 * things.
 *
 * The block goes last, before `</body>`. The starter kits build their dev
 * harness in the body, so a block in `<head>` loses to the harness's own
 * assignment and creates `window.$alea` early enough that the harness is never
 * built.
 *
 * Only the `$alea.paramsSchema` form is written. The other three are import
 * paths, and rewriting somebody's `$fx.params` call would edit code that still
 * has to run.
 */
export function withParams(html: string, specs: ParamSpec[]): string {
    let out = html;

    // Measured, not matched, so a `]` inside a string or a comment cannot cut
    // an assignment short.
    for (;;) {
        const at = out.search(/(?:window\.)?\$alea\.paramsSchema\s*=\s*\[/);
        if (at === -1) break;
        const open = out.indexOf("[", at);
        const raw = arrayLiteralAt(out, open);
        if (raw === null) break;
        let end = open + raw.length;
        while (out[end] === ";" || out[end] === " " || out[end] === "\t") end++;
        if (out[end] === "\r") end++;
        if (out[end] === "\n") end++;
        let begin = at;
        while (begin > 0 && (out[begin - 1] === " " || out[begin - 1] === "\t")) begin--;
        out = out.slice(0, begin) + out.slice(end);
    }

    // A script tag left holding nothing but whitespace after that.
    out = out.replace(/[ \t]*<script>\s*<\/script>[ \t]*\r?\n?/gi, "");

    if (specs.length === 0) return out;

    const body = specs.map((spec) => `    ${JSON.stringify(spec)}`).join(",\n");
    const block = `<script>
  // Declared parameters. Edit here or in the studio panel; they are the same
  // thing. Written on chain at publish, and read by your code as
  // alea.param(id, fallback).
  window.$alea = window.$alea || {};
  window.$alea.paramsSchema = [
${body}
  ];
</script>`;

    if (/<\/body>/i.test(out)) return out.replace(/<\/body>/i, `${block}\n</body>`);
    if (/<\/html>/i.test(out)) return out.replace(/<\/html>/i, `${block}\n</html>`);
    return `${out}\n${block}\n`;
}
