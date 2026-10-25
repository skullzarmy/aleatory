import assert from "node:assert";
import { decodeCode } from "../src/indexer/code.js";
import { extractPieceMetadata } from "../src/indexer/metadata.js";

export async function runMetadataTests() {
    console.log("Testing Metadata & Code Decoder...");

    // 1. Direct metadata object
    const meta1 = extractPieceMetadata({
        aleaSeed: "opMintHash123",
        aleaParams: JSON.stringify({ density: 100 }),
    });
    assert.strictEqual(meta1.seed, "opMintHash123");
    assert.deepStrictEqual(meta1.params, { density: 100 });

    // 2. Attributes array (Objkt / TzKT style)
    const meta2 = extractPieceMetadata({
        attributes: [
            { name: "aleaSeed", value: "opFromAttributes456" },
            { name: "param:density", value: 250 },
            { name: "Palette", value: "Neon" },
        ],
    });
    assert.strictEqual(meta2.seed, "opFromAttributes456");
    assert.strictEqual(meta2.params.density, 250);
    assert.strictEqual(meta2.features.Palette, "Neon");

    // 3. ArtifactUri query parameters fallback
    const meta3 = extractPieceMetadata({
        artifactUri: "ipfs://Qm123?seed=opQuerySeed789&p.palette=Dusk&p.density=180",
    });
    assert.strictEqual(meta3.seed, "opQuerySeed789");
    assert.strictEqual(meta3.params.palette, "Dusk");
    assert.strictEqual(meta3.params.density, 180);

    // 4. Code decoding (identity)
    const rawHtml = "<html><body>art</body></html>";
    const hex = Buffer.from(rawHtml, "utf8").toString("hex");
    const decoded = await decodeCode(hex, "identity");
    assert.strictEqual(decoded, rawHtml);

    console.log("  ok: Metadata extraction and code decoder verified");
}
