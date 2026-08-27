/** Mutez as tez, at the precision the number deserves. */
export function tez(mutez: number): string {
    const t = mutez / 1_000_000;
    if (t === 0) return "0 ꜩ";
    if (Math.abs(t) < 0.01) return `${t.toFixed(6).replace(/0+$/, "")} ꜩ`;
    return `${t.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 6,
    })} ꜩ`;
}

export function bps(n: number): string {
    return `${(n / 100).toFixed(2).replace(/\.00$/, "")}%`;
}

export function shortAddress(a: string): string {
    if (!a || a.length < 12) return a;
    return `${a.slice(0, 6)}…${a.slice(-4)}`;
}
