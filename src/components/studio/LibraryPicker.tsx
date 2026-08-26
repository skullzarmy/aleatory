"use client";

import { CATALOGUE, declaredIn, withLibraries } from "@/lib/libraries";

/**
 * Which libraries this generator asks for.
 *
 * It edits the document. Toggling p5 writes a `<meta name="alea:library">` tag
 * into the artist's own file, which is what makes the file portable: download
 * it, work on it somewhere else for a week, upload it again, and it still says
 * what it needs. A preference stored beside the document instead of inside it
 * would be lost on the first round trip.
 *
 * Nothing is bundled. The bytes stay out of the artist's generator and a
 * renderer loads them, which is the whole reason to declare one rather than
 * paste it in.
 */
export function LibraryPicker({
    html,
    onChange,
}: {
    html: string;
    onChange: (html: string) => void;
}) {
    const declared = declaredIn(html);
    const unknown = declared.filter(
        (c) => !CATALOGUE.some((d) => `${d.id}@${d.version}` === c),
    );

    function toggle(coordinate: string, on: boolean) {
        const next = on
            ? [...declared, coordinate]
            : declared.filter((c) => c !== coordinate);
        onChange(withLibraries(html, next));
    }

    return (
        <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
                Declared libraries are loaded for you, so they cost you none of your
                generator&apos;s size. Anything else your piece needs, put in the file.
            </p>

            <ul className="space-y-2">
                {CATALOGUE.map((d) => {
                    const coordinate = `${d.id}@${d.version}`;
                    const on = declared.includes(coordinate);
                    return (
                        <li key={coordinate}>
                            <label className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3 hover:bg-accent">
                                <input
                                    type="checkbox"
                                    checked={on}
                                    onChange={(e) => toggle(coordinate, e.target.checked)}
                                    className="mt-0.5 accent-alea-600"
                                />
                                <span className="min-w-0">
                                    <span className="block text-sm font-medium">
                                        {d.label} {d.version}
                                    </span>
                                    <span className="block text-xs text-muted-foreground">
                                        {(d.approxBytes / 1024).toFixed(0)} KB, loaded at render
                                        and checked against{" "}
                                        <code className="font-mono">{d.hash.slice(0, 12)}…</code>
                                    </span>
                                </span>
                            </label>
                        </li>
                    );
                })}
            </ul>

            {unknown.length > 0 && (
                <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
                    This file asks for {unknown.join(", ")}, which is not in the catalogue.
                    Nothing will load it, so either bundle it into the file or remove the
                    tag.
                </p>
            )}

            <p className="text-xs text-muted-foreground">
                This edits your file. The tag travels with it.
            </p>
        </div>
    );
}
