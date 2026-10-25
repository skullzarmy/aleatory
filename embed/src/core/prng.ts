/**
 * String hash for PRNG seeding.
 */
export function xmur3(str: string): () => number {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
        h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
        h = (h << 13) | (h >>> 19);
    }
    return () => {
        h = Math.imul(h ^ (h >>> 16), 2246822507);
        h = Math.imul(h ^ (h >>> 13), 3266489909);
        h ^= h >>> 16;
        return h >>> 0;
    };
}

/**
 * 32-bit pseudo-random number generator.
 */
export function sfc32(a: number, b: number, c: number, d: number): () => number {
    return () => {
        a >>>= 0;
        b >>>= 0;
        c >>>= 0;
        d >>>= 0;
        let t = (a + b) | 0;
        a = b ^ (b >>> 9);
        b = (c + (c << 3)) | 0;
        c = (c << 21) | (c >>> 11);
        d = (d + 1) | 0;
        t = (t + d) | 0;
        c = (c + t) | 0;
        return (t >>> 0) / 4294967296;
    };
}

/**
 * Creates the canonical PRNG stream with zero warm-up draws.
 */
export function createPrng(seed: string) {
    const s = xmur3(String(seed || "unseeded"));
    const rand = sfc32(s(), s(), s(), s());

    return {
        /** Float in range [0, 1) */
        rand,
        /** Float in range [0, 1) */
        random: rand,
        /** Inclusive integer between lo and hi */
        randInt(lo: number, hi: number): number {
            return Math.floor(rand() * (hi - lo + 1)) + lo;
        },
        /** Float between lo and hi */
        randBetween(lo: number, hi: number): number {
            return lo + rand() * (hi - lo);
        },
        /** Pick random element from an array */
        pick<T>(arr: T[]): T {
            return arr[Math.floor(rand() * arr.length)];
        },
        /** Returns true with probability p */
        chance(p: number): boolean {
            return rand() < p;
        },
    };
}
