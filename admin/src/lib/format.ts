/** Mutez as tez, at the precision the number deserves. */
export function tez(mutez: number): string {
    const t = mutez / 1_000_000;
    if (t === 0) return "0 ꜩ";
    if (Math.abs(t) < 0.01) return `${t.toFixed(6).replace(/0+$/, "")} ꜩ`;
    // Pinned, because the console renders on a server and hydrates in a
    // browser, and the two disagree about digit grouping under any locale that
    // is not the server's. React tears the page down over that.
    return `${t.toLocaleString("en-US", {
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
