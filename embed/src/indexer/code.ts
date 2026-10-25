/**
 * Decodes contract storage code bytes into an HTML string.
 */
export async function decodeCode(hex: string, encoding = "identity"): Promise<string> {
    const clean = hex.replace(/^0x/, "").trim();
    if (clean.length === 0) return "";
    if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(clean)) {
        throw new Error("Invalid hex string for code storage");
    }

    const bytes = new Uint8Array((clean.match(/.{2}/g) ?? []).map((b) => parseInt(b, 16)));
    if (encoding !== "gzip") {
        return new TextDecoder().decode(bytes);
    }

    if (typeof DecompressionStream === "undefined") {
        throw new Error("DecompressionStream is not supported in this environment");
    }

    const stream = new Blob([bytes as unknown as BlobPart])
        .stream()
        .pipeThrough(new DecompressionStream("gzip"));

    return new Response(stream).text();
}
