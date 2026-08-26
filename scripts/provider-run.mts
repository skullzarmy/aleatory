/**
 * Run the provider once, locally.
 *
 * The deployed daemon is a Netlify function on a cron, which needs Netlify to
 * invoke it and Netlify Blobs to hold its claims. Neither exists on a laptop,
 * so there was no way to watch the loop work short of deploying it. This is
 * that way.
 *
 *   npm run provider:check   scan and report, change nothing
 *   npm run provider:run     render, pin and publish
 *
 * A run spends render budget, pinning quota and the agent's gas, and writes a
 * token's metadata permanently: `set_token_metadata` accepts one write per
 * token and refuses the second.
 *
 * No claim store here. That exists to stop two concurrent invocations
 * rendering the same piece; one process cannot race itself.
 */
import dotenv from "dotenv";

// Loaded before the modules below, and they are imported dynamically for that
// reason. A static import is hoisted above every statement in this file, so
// the daemon would read process.env before dotenv had filled it and come up
// with no configuration at all while this script reported everything fine.
dotenv.config();

const { collectionsServed, collectionsFactories, pendingIn, handle } = await import(
    "../netlify/functions/provider.mts"
);
const { renderConfigFromEnv } = await import("../netlify/functions/lib/render.mts");

/** `provider:check` sets this. Anything else does the work. */
const DRY = process.env.PROVIDER_DRY === "1";

function check(name: string, ok: boolean, detail = ""): boolean {
    console.log(`  ${ok ? "ok  " : "MISS"} ${name}${detail ? `  ${detail}` : ""}`);
    return ok;
}

const router = (
    process.env.ALEA_ROUTER_ADDRESS ||
    process.env.NEXT_PUBLIC_ROUTER_ADDRESS ||
    ""
).trim();
const override = (
    process.env.ALEA_FACTORIES ||
    process.env.ALEA_FACTORY_ADDRESS ||
    ""
).trim();

console.log("\nConfiguration");
const ready = [
    check("provider address", Boolean(process.env.ALEA_PROVIDER_ADDRESS), process.env.ALEA_PROVIDER_ADDRESS ?? ""),
    check("agent key", Boolean(process.env.ALEA_AGENT_SK)),
    check("pinning", Boolean(process.env.PINATA_JWT)),
    check("rendering", Boolean(renderConfigFromEnv())),
    // Where the daemon looks for work. Unset, it scans nothing and reports
    // serving no collections, which reads exactly like "nobody has named you
    // as their provider" while every check above passes.
    check(
        "router",
        Boolean(router || override),
        override ? `overridden: ${override}` : router,
    ),
].every(Boolean);

if (!ready) {
    console.log("\nSomething is unset. See .env.example.\n");
    process.exit(1);
}

const factories = await collectionsFactories();
console.log(
    `\nFactories watched (${factories.length})` +
        (override ? ", from ALEA_FACTORIES" : ", from the router"),
);
for (const f of factories) console.log(`  ${f}`);
if (factories.length === 0) {
    console.log("  none. Nothing will be found, whoever names this provider.");
}

console.log("\nCollections this provider serves");
const collections = await collectionsServed();
if (collections.length === 0) {
    console.log("  none. A collection names its provider at deploy, or through set_provider.\n");
    process.exit(0);
}
for (const c of collections) console.log(`  ${c}`);

console.log("\nPieces waiting");
let total = 0;
for (const collection of collections) {
    const waiting = await pendingIn(collection).catch((e) => {
        console.log(`  ${collection}  scan failed: ${e instanceof Error ? e.message : e}`);
        return [];
    });
    if (waiting.length === 0) {
        console.log(`  ${collection}  nothing waiting`);
        continue;
    }
    for (const piece of waiting) {
        total++;
        console.log(`  ${piece.collection} #${piece.tokenId}  seed ${piece.seed.slice(0, 12)}…`);
        if (DRY) continue;
        try {
            const hash = await handle(piece);
            console.log(`      published, op ${hash}`);
        } catch (e) {
            console.log(`      FAILED: ${e instanceof Error ? e.message : e}`);
        }
    }
}

console.log(
    total === 0
        ? "\nNothing to do.\n"
        : DRY
          ? `\n${total} piece${total === 1 ? "" : "s"} waiting. \`npm run provider:run\` publishes them.\n`
          : `\nDone, ${total} piece${total === 1 ? "" : "s"}.\n`,
);
