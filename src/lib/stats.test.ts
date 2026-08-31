/**
 * The platform's numbers, and the channel names they become.
 *
 * The figures themselves need a chain and are checked against one when there
 * is a connection: what matters is that they are totals rather than a first
 * page, and that they come from every factory and marketplace the router has
 * ever named instead of only the current ones.
 *
 * The rendering needs no network and is checked always. A channel name is the
 * whole product here, so a placeholder that silently renders as nothing would
 * put an empty label in a sidebar with no error anywhere.
 *
 * Run: npm test
 */


import { platformStats, render, EMPTY_STATS, type PlatformStats } from "./stats";

let failures = 0;

function check(name: string, ok: boolean, detail?: string) {
    if (ok) {
        console.log(`  ok   ${name}`);
    } else {
        failures++;
        console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
    }
}

const sample: PlatformStats = {
    generators: 12,
    pieces: 1247,
    mintedMutez: 913_270_000,
    treasuryMutez: 8_750_000,
    unsweptMutez: 250_000,
    renderGasMutez: 700_000,
    earnedMutez: 9_700_000,
    problems: [],
};

async function run() {
    console.log("\nStat channel names\n");

    check(
        "a count reads as a number and not a year",
        render("Pieces: {pieces}", sample) === "Pieces: 1,247",
        render("Pieces: {pieces}", sample),
    );
    check(
        "tez is short enough for a sidebar",
        render("Minted: {minted} ꜩ", sample) === "Minted: 913.27 ꜩ",
        render("Minted: {minted} ꜩ", sample),
    );
    check(
        "every figure has a placeholder",
        ["generators", "pieces", "minted", "earned", "treasury", "unswept", "renderGas"].every(
            (key) => render(`{${key}}`, sample) !== `{${key}}`,
        ),
    );
    check(
        "an unknown placeholder is left visible",
        render("{nope}", sample) === "{nope}",
        "a silent blank would sit in a sidebar with nothing to explain it",
    );
    check(
        "emoji and wording survive",
        render("🎨 Generators: {generators}", sample) === "🎨 Generators: 12",
    );
    check(
        "a name is cut to Discord's limit",
        render(`${"x".repeat(200)}{pieces}`, sample).length === 100,
    );

    // Thousands and millions, because mainnet will not stay in two decimals.
    for (const [mutez, expected] of [
        [0, "0"],
        [1_500_000, "1.5"],
        [913_270_000, "913.27"],
        [2_500_000_000, "2.5K"],
        [4_200_000_000_000, "4.2M"],
    ] as const) {
        const out = render("{minted}", { ...sample, mintedMutez: mutez });
        check(`${mutez} mutez reads as ${expected}`, out === expected, out);
    }

    console.log("\nReading the chain\n");

    let online = true;
    try {
        await fetch("https://api.shadownet.tzkt.io/v1/head", { method: "HEAD" });
    } catch {
        online = false;
    }

    if (!online || !process.env.NEXT_PUBLIC_ROUTER_ADDRESS) {
        console.log(
            !online ? "  skip, no connection\n" : "  skip, no router configured\n",
        );
    } else {
        const stats = await platformStats();
        check("the router answered", stats.problems.length === 0, stats.problems.join("; "));
        check("generators were found", stats.generators > 0, String(stats.generators));
        check("pieces were found", stats.pieces > 0, String(stats.pieces));
        check(
            "a piece cannot exist without a generator",
            stats.pieces === 0 || stats.generators > 0,
        );
        check(
            "minting cost something",
            stats.mintedMutez > 0,
            `${stats.mintedMutez} mutez`,
        );
        check(
            "earnings are the three parts and nothing else",
            stats.earnedMutez ===
                stats.treasuryMutez + stats.unsweptMutez + stats.renderGasMutez,
        );
        // Every collector's tez goes to an artist, a provider or a marketplace,
        // so the platform's cut of primary sales cannot exceed what was spent.
        check(
            "render gas came out of what was minted",
            stats.renderGasMutez <= stats.mintedMutez,
            `${stats.renderGasMutez} > ${stats.mintedMutez}`,
        );
    }

    check("an unread platform reports itself unread", EMPTY_STATS.problems.length > 0);

    console.log(
        failures === 0
            ? "\nThe numbers are totals, and they fit in a channel name.\n"
            : `\n${failures} check(s) failed.\n`,
    );
    process.exit(failures === 0 ? 0 : 1);
}

run().catch((e) => {
    console.error("\nThe suite could not run:", e instanceof Error ? e.message : e);
    process.exit(1);
});
