/**
 * A small markdown renderer, for this repository's own documents.
 *
 * Scoped deliberately: it handles what `docs/*.md` actually contains, and the
 * input is files in this repository rather than anything a visitor supplies.
 * It is not a CommonMark implementation and should not be pointed at untrusted
 * text, so every value it emits is HTML-escaped first and the only markup that
 * survives is the markup this function itself writes.
 */

const ESCAPES: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
};

function escape(s: string): string {
    return s.replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/** Inline markup, applied to already-escaped text. */
function inline(s: string): string {
    return escape(s)
        .replace(/`([^`]+)`/g, '<code class="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(
            /\[([^\]]+)\]\(([^)\s]+)\)/g,
            '<a href="$2" class="underline underline-offset-2 hover:text-foreground">$1</a>',
        );
}

export interface Heading {
    depth: number;
    text: string;
    id: string;
}

function slug(text: string): string {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
}

export interface RenderedDoc {
    html: string;
    headings: Heading[];
}

export function renderMarkdown(source: string): RenderedDoc {
    const lines = source.replace(/\r\n/g, "\n").split("\n");
    const out: string[] = [];
    const headings: Heading[] = [];

    let i = 0;
    let paragraph: string[] = [];

    function flushParagraph() {
        if (paragraph.length === 0) return;
        out.push(`<p class="my-4 leading-relaxed">${inline(paragraph.join(" "))}</p>`);
        paragraph = [];
    }

    while (i < lines.length) {
        const line = lines[i];

        // Fenced code. Taken verbatim: nothing inside is interpreted.
        if (/^```/.test(line)) {
            flushParagraph();
            const body: string[] = [];
            i++;
            while (i < lines.length && !/^```/.test(lines[i])) body.push(lines[i++]);
            i++;
            out.push(
                `<pre class="my-4 overflow-x-auto rounded-lg border border-border bg-muted/50 p-4"><code class="font-mono text-xs leading-relaxed">${escape(
                    body.join("\n"),
                )}</code></pre>`,
            );
            continue;
        }

        const heading = /^(#{1,6})\s+(.*)$/.exec(line);
        if (heading) {
            flushParagraph();
            const depth = heading[1].length;
            const text = heading[2].trim();
            const id = slug(text);
            headings.push({ depth, text, id });
            const size =
                depth === 1
                    ? "mt-0 text-2xl font-semibold tracking-tight"
                    : depth === 2
                      ? "mt-10 text-lg font-semibold tracking-tight"
                      : "mt-8 text-sm font-semibold uppercase tracking-wide text-muted-foreground";
            out.push(`<h${depth} id="${id}" class="${size} scroll-mt-24">${inline(text)}</h${depth}>`);
            i++;
            continue;
        }

        if (/^(---|\*\*\*|___)\s*$/.test(line)) {
            flushParagraph();
            out.push('<hr class="my-8 border-border" />');
            i++;
            continue;
        }

        // Tables: a header row, a separator, then body rows.
        if (/^\|/.test(line) && i + 1 < lines.length && /^\|[\s:|-]+\|?\s*$/.test(lines[i + 1])) {
            flushParagraph();
            const cells = (row: string) =>
                row.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
            const head = cells(line);
            i += 2;
            const body: string[][] = [];
            while (i < lines.length && /^\|/.test(lines[i])) body.push(cells(lines[i++]));
            out.push(
                `<div class="my-6 overflow-x-auto"><table class="w-full border-collapse text-sm">` +
                    `<thead><tr>${head
                        .map(
                            (c) =>
                                `<th class="border-b border-border px-3 py-2 text-left font-medium">${inline(c)}</th>`,
                        )
                        .join("")}</tr></thead>` +
                    `<tbody>${body
                        .map(
                            (row) =>
                                `<tr>${row
                                    .map(
                                        (c) =>
                                            `<td class="border-b border-border px-3 py-2 align-top text-muted-foreground">${inline(c)}</td>`,
                                    )
                                    .join("")}</tr>`,
                        )
                        .join("")}</tbody></table></div>`,
            );
            continue;
        }

        const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
        const numbered = /^\s*\d+\.\s+(.*)$/.exec(line);
        if (bullet || numbered) {
            flushParagraph();
            const ordered = Boolean(numbered);
            const items: string[] = [];
            while (i < lines.length) {
                const m = ordered
                    ? /^\s*\d+\.\s+(.*)$/.exec(lines[i])
                    : /^\s*[-*]\s+(.*)$/.exec(lines[i]);
                if (m) {
                    items.push(m[1]);
                    i++;
                    // A wrapped list item continues on an indented line.
                    while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*]|\d+\.)\s/.test(lines[i])) {
                        items[items.length - 1] += ` ${lines[i].trim()}`;
                        i++;
                    }
                    continue;
                }
                break;
            }
            const tag = ordered ? "ol" : "ul";
            out.push(
                `<${tag} class="my-4 ${ordered ? "list-decimal" : "list-disc"} space-y-1.5 pl-6">${items
                    .map((it) => `<li class="leading-relaxed">${inline(it)}</li>`)
                    .join("")}</${tag}>`,
            );
            continue;
        }

        if (line.trim() === "") {
            flushParagraph();
            i++;
            continue;
        }

        paragraph.push(line.trim());
        i++;
    }

    flushParagraph();
    return { html: out.join("\n"), headings };
}
