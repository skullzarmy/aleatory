import { runDocumentTests } from "./document.test.js";
import { runLibraryTests } from "./libraries.test.js";
import { runMetadataTests } from "./metadata.test.js";
import { runPrngTests } from "./prng.test.js";

async function main() {
    console.log("\n--- @aleatory/embed test suite ---\n");
    runPrngTests();
    runDocumentTests();
    runLibraryTests();
    await runMetadataTests();
    console.log("\nAll @aleatory/embed tests passed.\n");
}

main().catch((err) => {
    console.error("Test failed:", err);
    process.exit(1);
});
