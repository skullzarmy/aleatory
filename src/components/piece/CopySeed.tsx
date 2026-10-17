"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import { tzktLink } from "@/lib/config";
import { shortAddress } from "@/lib/utils";

export function CopySeed({ seed }: { seed: string }) {
    const [copied, setCopied] = useState(false);
    const timer = useRef<number | null>(null);

    useEffect(() => {
        return () => {
            if (timer.current !== null) window.clearTimeout(timer.current);
        };
    }, []);

    const copy = () => {
        if (!navigator?.clipboard?.writeText) return;
        void navigator.clipboard.writeText(seed).then(
            () => {
                setCopied(true);
                if (timer.current !== null) window.clearTimeout(timer.current);
                timer.current = window.setTimeout(() => setCopied(false), 1400);
            },
            () => {},
        );
    };

    return (
        <span className="inline-flex items-center gap-2">
            <button
                type="button"
                onClick={copy}
                className="inline-flex items-center gap-1 font-mono text-xs hover:underline"
                title={copied ? "Seed copied" : seed}
                aria-label={copied ? "Seed copied" : "Copy seed"}
            >
                <span>{shortAddress(seed, 8, 6)}</span>
                {copied ? (
                    <span className="inline-flex items-center gap-0.5 text-success">
                        <Check size={12} aria-hidden />
                        <span className="font-sans text-[11px]">Copied</span>
                    </span>
                ) : (
                    <Copy size={12} className="text-muted-foreground" aria-hidden />
                )}
            </button>
            <a
                href={tzktLink(seed)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center text-muted-foreground hover:text-foreground"
                title="View on TzKT"
                aria-label="View on TzKT"
            >
                <ExternalLink size={12} aria-hidden />
            </a>
        </span>
    );
}
