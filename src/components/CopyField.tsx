"use client";

import { useState } from "react";

/** A labeled value with a copy button. Used anywhere a URL or template is meant to be pasted somewhere else, not read here. */
export function CopyField({ value, label }: { value: string; label: string }) {
    const [copied, setCopied] = useState(false);
    return (
        <button
            type="button"
            onClick={() => {
                void navigator.clipboard.writeText(value).then(() => {
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 1600);
                });
            }}
            className="flex w-full items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-left text-xs hover:bg-accent"
        >
            <span className="shrink-0 text-muted-foreground">{label}</span>
            <span className="min-w-0 flex-1 truncate font-mono">{value}</span>
            <span className="shrink-0 text-muted-foreground">{copied ? "Copied" : "Copy"}</span>
        </button>
    );
}
