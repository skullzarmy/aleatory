/**
 * One pass, then exit.
 *
 *   npm run bot:check   read the chain, print what the names would be
 *   npm run bot:run     read the chain and write the names
 *
 * `--dry-run` is the difference, and it is how to see the figures before
 * anything lands in a live server's sidebar.
 */
import dotenv from "dotenv";
import { platformStats, render } from "./stats";
import { channelsFromEnv, writeAll } from "./discord";
import { network, router, provider } from "./chain";

dotenv.config();

const DRY = process.argv.includes("--dry-run");

async function main() {
    const token = process.env.DISCORD_BOT_TOKEN || "";
    const channels = channelsFromEnv();

    const missing = [
        !router() && "ALEA_ROUTER_ADDRESS",
        !provider() && "ALEA_PROVIDER_ADDRESS",
        !DRY && !token && "DISCORD_BOT_TOKEN",
        !DRY && channels.length === 0 && "DISCORD_STAT_CHANNELS",
    ].filter(Boolean);

    if (missing.length > 0) {
        console.log(`\nNot configured: ${missing.join(", ")}. See bot/README.md.\n`);
        process.exit(1);
    }

    console.log(`\n${network()}, router ${router()}\n`);

    const stats = await platformStats();
    const asTez = (mutez: number) => `${(mutez / 1e6).toFixed(6)} tez`;

    for (const [label, value] of [
        ["generators", String(stats.generators)],
        ["pieces", String(stats.pieces)],
        ["minted", asTez(stats.mintedMutez)],
        ["earned", asTez(stats.earnedMutez)],
        ["  treasury", asTez(stats.treasuryMutez)],
        ["  unswept", asTez(stats.unsweptMutez)],
        ["  render gas", asTez(stats.renderGasMutez)],
    ] as const) {
        console.log(`  ${label.padEnd(14)}${value}`);
    }

    if (stats.problems.length > 0) {
        // Every figure that failed is zero, and writing a zero over a real
        // number reads as the platform having lost everything.
        console.log(`\nIncomplete, nothing written:\n  ${stats.problems.join("\n  ")}\n`);
        process.exit(1);
    }

    console.log("");
    if (channels.length === 0) {
        console.log("  no channels configured\n");
        return;
    }

    if (DRY) {
        for (const channel of channels) {
            console.log(`  ${channel.id}  "${render(channel.label, stats)}"`);
        }
        console.log("\n  dry run, nothing written\n");
        return;
    }

    for (const result of await writeAll(token, channels, stats)) {
        console.log(`  ${result.outcome.padEnd(10)}${result.id}  ${result.detail}`);
    }
    console.log("");
}

main().catch((e) => {
    console.error(`\n${e instanceof Error ? e.message : e}\n`);
    process.exit(1);
});
