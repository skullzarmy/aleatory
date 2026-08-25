import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

/** Mutez to a tez string, trimmed. 1500000 -> "1.5". */
export function formatTez(mutez: number | string): string {
    const n = typeof mutez === "string" ? parseInt(mutez, 10) : mutez;
    if (!Number.isFinite(n)) return "0";
    const tez = n / 1_000_000;
    return tez
        .toFixed(6)
        .replace(/\.?0+$/, "")
        .replace(/^$/, "0");
}

export function shortAddress(a: string, lead = 5, tail = 4): string {
    if (!a || a.length <= lead + tail + 1) return a;
    return `${a.slice(0, lead)}…${a.slice(-tail)}`;
}

/** "3 minutes ago", for feed rows. */
export function timeAgo(iso: string): string {
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return "";
    const secs = Math.max(0, (Date.now() - then) / 1000);
    const steps: [number, string][] = [
        [60, "second"],
        [60, "minute"],
        [24, "hour"],
        [7, "day"],
        [4.345, "week"],
        [12, "month"],
    ];
    let value = secs;
    let unit = "second";
    for (const [size, name] of steps) {
        if (value < size) break;
        value = value / size;
        unit = name;
    }
    const rounded = Math.floor(value);
    if (unit === "second" && rounded < 10) return "just now";
    return `${rounded} ${unit}${rounded === 1 ? "" : "s"} ago`;
}
