/**
 * What a mint announcement says about an edition.
 *
 * The bot reported "20 of 50" for a generator whose artist had already cut
 * the edition to 20. The number was cached for the life of the process behind
 * a comment asserting it could not change, which `set_edition_size` does, so
 * the wrong figure went out on every mint until the bot restarted.
 *
 * Run: npm test
 */

import { mintEmbed } from "./announce";

let failures = 0;

function check(name: string, ok: boolean, detail?: string) {
    if (ok) {
        console.log(`  ok   ${name}`);
    } else {
        failures++;
        console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
    }
}

const mint = (tokenId: string, editionSize: number) =>
    mintEmbed({
        contract: "KT1Generator",
        tokenId,
        name: `Piece #${Number(tokenId) + 1}`,
        imageUri: "",
        collector: "tz1collector",
        paidMutez: 1_000_000,
        params: {},
        generatorName: "Scuni",
        artist: "tz1artist",
        editionSize,
        at: "2026-10-12T00:00:00Z",
    });

const editionOf = (e: ReturnType<typeof mintEmbed>) =>
    e.fields?.find((f) => f.name === "Edition")?.value ?? "";

console.log("\nEdition on a mint announcement\n");

check(
    "counts from one, because token ids count from zero",
    editionOf(mint("0", 50)) === "1 of 50",
    editionOf(mint("0", 50)),
);

check(
    "an open edition has no total to print",
    editionOf(mint("4", 0)) === "5 of open",
    editionOf(mint("4", 0)),
);

check(
    "a reduced edition reads against the size it was reduced to",
    editionOf(mint("19", 20)) === "20 of 20, sold out",
    editionOf(mint("19", 20)),
);

console.log("\nSelling out\n");

check(
    "the last piece of a finite edition says so",
    editionOf(mint("19", 20)).endsWith("sold out"),
    editionOf(mint("19", 20)),
);

check(
    "and is coloured and footed differently, so it reads as an event",
    mint("19", 20).color !== mint("18", 20).color &&
        mint("19", 20).footer?.text !== mint("18", 20).footer?.text,
);

check(
    "the piece before it does not",
    !editionOf(mint("18", 20)).includes("sold out"),
    editionOf(mint("18", 20)),
);

check(
    "an open edition never sells out, however many are minted",
    !editionOf(mint("999", 0)).includes("sold out"),
    editionOf(mint("999", 0)),
);

console.log(
    failures === 0
        ? "\nAn announcement states the edition as it stands now.\n"
        : `\n${failures} check(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
