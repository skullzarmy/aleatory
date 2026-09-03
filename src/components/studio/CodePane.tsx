"use client";

import { useEffect, useRef, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { html as htmlLang } from "@codemirror/lang-html";
import { oneDark } from "@codemirror/theme-one-dark";
import { Upload } from "lucide-react";
import { packageFromFile } from "@/lib/project";

/**
 * The generator, open, on the left.
 *
 * The document is the work, so the document is on screen and typing in it
 * redraws the piece.
 *
 * Edits are debounced rather than applied per keystroke. A generator is a whole
 * document and half-typed HTML is not valid HTML, so redrawing on every
 * character means the preview spends most of its time showing the consequences
 * of an unfinished tag.
 *
 * Local text only. Nothing here is uploaded and nothing here is fetched.
 */
export function CodePane({
    value,
    onChange,
    onReplace,
}: {
    value: string;
    /** Debounced, for the preview. */
    onChange: (html: string) => void;
    /** A whole new document, from a file or a paste. Resets the buffer. */
    onReplace: (html: string) => void;
}) {
    const [buffer, setBuffer] = useState(value);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const file = useRef<HTMLInputElement>(null);

    // An outside replacement wins. This is an import, or another draft loading,
    // not something the artist typed.
    useEffect(() => {
        setBuffer(value);
    }, [value]);

    useEffect(() => {
        if (buffer === value) return;
        const t = setTimeout(() => onChange(buffer), 400);
        return () => clearTimeout(t);
    }, [buffer, value, onChange]);

    async function load(f: File) {
        setBusy(true);
        setError(null);
        try {
            // The same packer the import page uses: a .zip is flattened into
            // one document here rather than at publish, so what runs in the
            // studio is byte for byte what goes on chain.
            const project = await packageFromFile(f);
            onReplace(project.html);
        } catch (e) {
            setError(e instanceof Error ? e.message : "That file could not be read");
        } finally {
            setBusy(false);
            if (file.current) file.current.value = "";
        }
    }

    const bytes = new TextEncoder().encode(buffer).length;

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-3 py-2">
                <span className="text-xs text-muted-foreground">
                    {buffer === value ? "index.html" : "index.html · unsaved"}
                </span>
                <div className="flex items-center gap-3">
                    <span className="tabular-nums text-xs text-muted-foreground">
                        {(bytes / 1024).toFixed(1)} KB
                    </span>
                    <button
                        type="button"
                        disabled={busy}
                        onClick={() => file.current?.click()}
                        className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs hover:bg-accent disabled:opacity-60"
                    >
                        <Upload size={12} aria-hidden />
                        {busy ? "Reading" : "Replace"}
                    </button>
                    <input
                        ref={file}
                        type="file"
                        accept=".html,.htm,.zip"
                        className="hidden"
                        onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) void load(f);
                        }}
                    />
                </div>
            </div>

            {error && (
                <p className="shrink-0 border-b border-destructive/40 bg-destructive/10 px-3 py-2 text-xs">
                    {error}
                </p>
            )}

            <div
                className="min-h-0 flex-1 overflow-auto"
                // A .zip or .html dropped anywhere on the code is an import.
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                    e.preventDefault();
                    const f = e.dataTransfer.files?.[0];
                    if (f) void load(f);
                }}
            >
                <CodeMirror
                    value={buffer}
                    onChange={setBuffer}
                    extensions={[htmlLang()]}
                    theme={oneDark}
                    height="100%"
                    style={{ height: "100%", fontSize: 13 }}
                    basicSetup={{
                        lineNumbers: true,
                        foldGutter: true,
                        highlightActiveLine: true,
                        autocompletion: false,
                    }}
                />
            </div>
        </div>
    );
}
