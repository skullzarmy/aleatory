import blake from "blakejs";

type Blake2bHexFn = (input: Uint8Array | string, key?: Uint8Array | null, outlen?: number) => string;

interface BlakeModule {
    blake2bHex?: Blake2bHexFn;
    default?: {
        blake2bHex?: Blake2bHexFn;
    };
}

/**
 * Computes the blake2b-256 hex digest of a byte array or string.
 */
export function blake2b256(input: Uint8Array | string): string {
    const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
    const mod = blake as unknown as BlakeModule;
    const fn = mod.blake2bHex ?? mod.default?.blake2bHex;

    if (!fn) {
        throw new Error("blakejs blake2bHex export not found");
    }

    return fn(bytes, null, 32);
}
