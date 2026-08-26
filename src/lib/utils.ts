import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

/**
 * Mutez to a tez string, trimmed. 1500000 -> "1.5".
 *
 * Formats from the integer rather than dividing, so a large amount keeps
 * every digit it arrived with.
 */
export function formatTez(mutez: number | string | bigint): string {
    let n: bigint;
    try {
        n = typeof mutez === "bigint" ? mutez : BigInt(Math.trunc(Number(mutez)));
    } catch {
        return "0";
    }
    const negative = n < 0n;
    if (negative) n = -n;
    const whole = n / 1_000_000n;
    const frac = (n % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
    return `${negative ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
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

    // Each entry is a unit and how many of it make the next one up. The unit
    // is the one you land *in*, not the one you divided by: naming it after
    // the divisor reported twenty-five minutes as "25 seconds ago".
    const units: [string, number][] = [
        ["second", 60],
        ["minute", 60],
        ["hour", 24],
        ["day", 7],
        ["week", 4.345],
        ["month", 12],
        ["year", Infinity],
    ];

    let value = secs;
    let i = 0;
    while (i < units.length - 1 && value >= units[i][1]) {
        value /= units[i][1];
        i++;
    }
    const unit = units[i][0];
    const rounded = Math.floor(value);
    if (unit === "second" && rounded < 10) return "just now";
    return `${rounded} ${unit}${rounded === 1 ? "" : "s"} ago`;
}

/**
 * Parse a tez amount typed by a person into mutez.
 *
 * Returns null for anything that is not a sane positive amount, so the value
 * shown in a preview and the value sent to a wallet are the same number,
 * derived once. Free text reaching an operation as NaN, zero, or something
 * absurd is a way to lose money to a typo.
 */
export const MAX_TEZ = 1_000_000;

export function parseTez(input: string): bigint | null {
    const trimmed = input.trim();
    if (!/^\d*\.?\d*$/.test(trimmed) || trimmed === "" || trimmed === ".") return null;
    const tez = Number(trimmed);
    if (!Number.isFinite(tez) || tez <= 0 || tez > MAX_TEZ) return null;
    // Through the decimal string rather than through a float, so 0.1 does not
    // arrive as 99999.99999999999.
    const [whole, frac = ""] = trimmed.split(".");
    const mutez =
        BigInt(whole || "0") * 1_000_000n + BigInt((frac + "000000").slice(0, 6));
    return mutez > 0n ? mutez : null;
}

/** An offer above this asks for a second look before it escrows real money. */
export const CONFIRM_ABOVE_MUTEZ = 100_000_000n;
