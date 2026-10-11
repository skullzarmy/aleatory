"use client";

import { useRef, useState } from "react";
import { X } from "lucide-react";

const MAX_TAG_LENGTH = 32;
const MAX_TAGS = 10;

function normalizeTag(raw: string): string {
    const stripped = raw.trim().replace(/^#+/, "").trim();
    return Array.from(stripped).slice(0, MAX_TAG_LENGTH).join("").trim();
}

/**
 * Tag entry field. Renders existing tags as removable badges, and creates
 * a new tag on comma, Enter, paste or blur.
 */
export function TagInput({
    tags,
    onChange,
    maxTags = MAX_TAGS,
    placeholder = "generative, glitch, 3d",
    disabled = false,
}: {
    tags: string[];
    onChange: (tags: string[]) => void;
    maxTags?: number;
    placeholder?: string;
    disabled?: boolean;
}) {
    const [input, setInput] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);

    const atLimit = tags.length >= maxTags;

    function addTags(raws: string[]) {
        const seen = new Set(tags.map((t) => t.toLowerCase()));
        const next: string[] = [];
        for (const raw of raws) {
            const cleaned = normalizeTag(raw);
            if (!cleaned) continue;
            const key = cleaned.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            next.push(cleaned);
            if (tags.length + next.length >= maxTags) break;
        }
        if (next.length > 0) {
            onChange([...tags, ...next]);
        }
    }

    function removeTag(index: number) {
        onChange(tags.filter((_, i) => i !== index));
    }

    function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
        if (e.key === "," || e.key === "Enter") {
            e.preventDefault();
            if (input.trim()) {
                addTags([input]);
                setInput("");
            }
        } else if (e.key === "Backspace" && input === "" && tags.length > 0) {
            e.preventDefault();
            removeTag(tags.length - 1);
        }
    }

    function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
        const val = e.target.value;
        if (val.includes(",")) {
            const parts = val.split(",");
            const complete = parts.slice(0, -1);
            const remainder = parts[parts.length - 1];
            addTags(complete);
            setInput(remainder);
        } else {
            setInput(val);
        }
    }

    function handleBlur() {
        if (input.trim()) {
            addTags([input]);
            setInput("");
        }
    }

    return (
        <div
            onClick={() => {
                if (!disabled) inputRef.current?.focus();
            }}
            className={`flex min-h-[42px] w-full flex-wrap items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm transition-colors ${
                disabled
                    ? "cursor-not-allowed opacity-50"
                    : "cursor-text focus-within:border-foreground focus-within:ring-1 focus-within:ring-foreground"
            }`}
        >
            {tags.map((tag, i) => (
                <span
                    key={`${tag}-${i}`}
                    className="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-xs font-medium text-foreground"
                >
                    <span>#{tag}</span>
                    {!disabled && (
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                removeTag(i);
                            }}
                            className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-background/80 hover:text-foreground focus-visible:outline-none"
                            aria-label={`Remove tag ${tag}`}
                        >
                            <X size={10} aria-hidden />
                        </button>
                    )}
                </span>
            ))}
            {!disabled && !atLimit && (
                <input
                    ref={inputRef}
                    type="text"
                    value={input}
                    onChange={handleChange}
                    onKeyDown={handleKeyDown}
                    onBlur={handleBlur}
                    placeholder={tags.length === 0 ? placeholder : "Add tag..."}
                    className="min-w-[6rem] flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                />
            )}
        </div>
    );
}
