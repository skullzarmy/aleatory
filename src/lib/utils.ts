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

// Each entry is a unit, its abbreviation, and how many of it make the next one
// up. The unit is the one you land *in*, not the one you divided by: naming it
// after the divisor reported twenty-five minutes as "25 seconds ago".
const UNITS: [name: string, short: string, per: number][] = [
    ["second", "s", 60],
    ["minute", "m", 60],
    ["hour", "h", 24],
    ["day", "d", 7],
    ["week", "w", 4.345],
    ["month", "mo", 12],
    ["year", "y", Infinity],
];

function age(iso: string): { value: number; unit: number } | null {
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return null;
    let value = Math.max(0, (Date.now() - then) / 1000);
    let i = 0;
    while (i < UNITS.length - 1 && value >= UNITS[i][2]) {
        value /= UNITS[i][2];
        i++;
    }
    return { value: Math.floor(value), unit: i };
}

/** "3 minutes ago", for feed rows. */
export function timeAgo(iso: string): string {
    const a = age(iso);
    if (!a) return "";
    if (a.unit === 0 && a.value < 10) return "just now";
    const unit = UNITS[a.unit][0];
    return `${a.value} ${unit}${a.value === 1 ? "" : "s"} ago`;
}

/**
 * "3m ago". The same measurement, for somewhere it has to share a line.
 *
 * A card puts this next to a name that is already truncating, so every word
 * spent here is taken off the name. Saying what the time refers to is worth
 * more than spelling out the unit.
 */
export function timeAgoShort(iso: string): string {
    const a = age(iso);
    if (!a) return "";
    if (a.unit === 0 && a.value < 10) return "just now";
    return `${a.value}${UNITS[a.unit][1]} ago`;
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
    const mutez = BigInt(whole || "0") * 1_000_000n + BigInt((frac + "000000").slice(0, 6));
    return mutez > 0n ? mutez : null;
}

/** An offer above this asks for a second look before it escrows real money. */
export const CONFIRM_ABOVE_MUTEZ = 100_000_000n;
