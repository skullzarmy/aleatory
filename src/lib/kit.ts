/**
 * A starter kit, assembled from whatever libraries somebody picked. The fixed
 * kits under `public/templates` answer "start me from p5"; this answers "three
 * and d3 and a canvas".
 *
 * Assembled in the browser, since every input is already on screen and `fflate`
 * is already a dependency.
 *
 * The documents come from `templates.generated.ts`, which
 * `scripts/build-templates.mts` writes from the same files it zips, and the
 * declarations from `withLibraries`, which is what the studio writes them with.
 * Nothing here keeps its own copy, so a kit built here cannot drift from one
 * downloaded from the releases.
 */
import { strToU8, zipSync } from "fflate";
import { TEMPLATE_README, KIT_SERVE } from "./templates.generated";
import { templateFor } from "./templates";
import { withLibraries } from "./libraries";
import { getKind } from "./kinds";

export interface KitLibrary {
    /** Exactly what goes in the meta tag. May name a file. */
    coordinate: string;
    id: string;
    version: string;
    /** What it puts on `window`. Null when the wrapper did not say. */
    global: string | null;
    bytes: number;
}

export interface KitInput {
    kindId: number;
    libraries: KitLibrary[];
    /**
     * `public/skill/aleatory-generator/SKILL.md`, fetched same-origin. Passed in
     * so an agent gets the rules being served now, and so a 200 kB guide does
     * not ride along in every page's bundle.
     */
    skill: string;
}

const kb = (bytes: number) => (bytes > 0 ? `${Math.round(bytes / 1024)} kB` : "unknown size");

/** `three@0.160.1  window.THREE`, or an honest blank. */
function globalLine(lib: KitLibrary): string {
    return lib.global ? `window.${lib.global}` : "see the package's own docs";
}

/**
 * A note under the declarations naming what each one puts on the window. The
 * tag says which library, never what to type.
 */
function libraryNote(libraries: KitLibrary[]): string {
    if (libraries.length === 0) return "";
    const widest = Math.max(...libraries.map((l) => l.coordinate.length));
    const rows = libraries
        .map((l) => `      ${l.coordinate.padEnd(widest)}  ${globalLine(l)}`)
        .join("\n");
    // No CDN URL anywhere in here, comment included: a file that says never to
    // write one should not contain one to grep for.
    return `  <!--
    Declared above, and loaded before your first line runs:

${rows}

    Never add a script tag pointing at a CDN. A piece is refused the network
    while it renders, so one that fetches is captured as a blank frame.
  -->`;
}

/** The document, with its declarations rewritten and the globals named. */
export function kitHtml(input: KitInput): string {
    const coordinates = input.libraries.map((l) => l.coordinate);
    const html = withLibraries(templateFor(input.kindId), coordinates);
    const note = libraryNote(input.libraries);
    if (!note) return html;

    // After the tags withLibraries just wrote, so the note sits with what it
    // describes, and the document is left alone when they are not found.
    const lastTag = html.lastIndexOf('<meta name="alea:library"');
    if (lastTag === -1) return html;
    const endOfLine = html.indexOf("\n", lastTag);
    if (endOfLine === -1) return html;

    return `${html.slice(0, endOfLine + 1)}${note}\n${html.slice(endOfLine + 1)}`;
}

function librarySection(libraries: KitLibrary[]): string {
    if (libraries.length === 0) {
        return "This kit declares no libraries. Everything it draws is its own code.\n";
    }
    const rows = libraries
        .map((l) => `| \`${l.coordinate}\` | \`${globalLine(l)}\` | ${kb(l.bytes)} |`)
        .join("\n");
    return `| library | available as | size |
|---|---|---|
${rows}

Declared as meta tags in \`index.html\`. \`serve.mjs\` loads them while you work.
A renderer loads them from the record on chain once you publish, so they cost
none of your generator's size.
`;
}

export function kitReadme(input: KitInput): string {
    const base = TEMPLATE_README[getKind(input.kindId).name] ?? "";
    return `${base.trimEnd()}

---

## This kit's libraries

${librarySection(input.libraries)}`;
}

/**
 * The file a coding agent is pointed at: the generator guide as served, plus
 * what an agent cannot infer about this kit, which is the globals that exist
 * and that installing or importing anything is wrong here.
 */
export function kitAgents(input: KitInput): string {
    const kind = getKind(input.kindId);

    // The fetch can fail, and the kit-specific half alone would leave an agent
    // the globals and none of the rules they exist under.
    const guide =
        input.skill.trim() ||
        `# Writing a generator for Aleatory

The generator guide could not be fetched when this kit was built. Read it at
https://aleatory.art/skill/aleatory-generator/SKILL.md before writing anything.

Until then, the three rules it opens with: one self-contained HTML file that
fetches nothing while it renders, the same seed drawing the same image forever,
and a call to \`alea.ready()\` when the drawing is finished.`;
    const available =
        input.libraries.length === 0
            ? "None. This kit declares no libraries.\n"
            : `${input.libraries
                  .map((l) =>
                      l.global
                          ? `- \`${l.global}\` — ${l.coordinate}`
                          : `- ${l.coordinate}, whose global this kit could not read. Check the package's own docs.`,
                  )
                  .join("\n")}\n`;

    return `${guide.trimEnd()}

---

# This kit

Base: ${kind.label}. ${kind.entrySpec}

## Libraries already present

Loaded before the generator's first line runs, as globals on \`window\`:

${available}
Do not add a \`<script>\` tag, do not install anything, and do not use \`import\`
or \`require\`. These are already there at runtime. A piece is refused the
network while it renders, so anything else has to be written into
\`index.html\` itself.

To change which libraries this kit has, edit the \`alea:library\` meta tags in
\`index.html\`. That tag is the whole declaration and it travels with the file.

## Running it

\`\`\`
node serve.mjs        # then open http://localhost:4321
\`\`\`

Reload for a new seed. \`?seed=<hex>\` draws one particular piece every time.
`;
}

/** Every file in the kit, by name. */
export function kitFiles(input: KitInput): Record<string, string> {
    return {
        "index.html": kitHtml(input),
        "serve.mjs": KIT_SERVE,
        "README.md": kitReadme(input),
        "AGENTS.md": kitAgents(input),
    };
}

/** What the download is called. */
export function kitName(input: KitInput): string {
    const parts = [
        getKind(input.kindId).name,
        ...input.libraries.map((l) => l.id.replace(/^@/, "")),
    ]
        .join("-")
        .replace(/[^a-z0-9-]+/gi, "-")
        .toLowerCase();
    return `aleatory-${parts}.zip`;
}

export function zipKit(input: KitInput): Uint8Array {
    const files = kitFiles(input);
    return zipSync(
        Object.fromEntries(Object.entries(files).map(([name, text]) => [name, strToU8(text)])),
        { level: 6 },
    );
}
