/**
 * Run the provider once, locally, without Netlify to invoke it or Blobs to hold
 * its claims.
 *
 *   npm run provider:check   scan and report, change nothing
 *   npm run provider:run     render, pin and publish
 *
 * A run spends render budget, pinning quota and the agent's gas, which is what
 * a dry run saves. `set_token_metadata` is rewritable by an authorised writer,
 * so a publish whose confirmation was missed can be corrected.
 *
 * No claim store: that stops two concurrent invocations rendering the same
 * piece, and one process cannot race itself.
 */
import dotenv from "dotenv";

// The modules below are imported dynamically because a static import is hoisted
// above this call, and the daemon would read an unfilled process.env.
dotenv.config();

const { generatorsServed, generatorsFactories, pendingIn, handle } = await import("./provider.mts");
const { renderConfigFromEnv } = await import("./render.mts");

/** Same flag as every other script here, and as `contract/deploy.ts`. */
const DRY = process.argv.includes("--dry-run");

function check(name: string, ok: boolean, detail = ""): boolean {
    console.log(`  ${ok ? "ok  " : "MISS"} ${name}${detail ? `  ${detail}` : ""}`);
    return ok;
}

const router = (
    process.env.ALEA_ROUTER_ADDRESS ||
    process.env.NEXT_PUBLIC_ROUTER_ADDRESS ||
    ""
).trim();
const override = (process.env.ALEA_FACTORIES || process.env.ALEA_FACTORY_ADDRESS || "").trim();

console.log("\nConfiguration");
const ready = [
    check(
        "provider address",
        Boolean(process.env.ALEA_PROVIDER_ADDRESS),
        process.env.ALEA_PROVIDER_ADDRESS ?? "",
    ),
    check("agent key", Boolean(process.env.ALEA_AGENT_SK)),
    check("pinning", Boolean(process.env.PINATA_JWT)),
    check("rendering", Boolean(renderConfigFromEnv())),
    // Where the daemon looks for work. Unset, it scans nothing and reports
    // serving no generators, which reads like nobody having named it.
    check("router", Boolean(router || override), override ? `overridden: ${override}` : router),
].every(Boolean);

if (!ready) {
    console.log("\nSomething is unset. See .env.example.\n");
    process.exit(1);
}

const factories = await generatorsFactories();
console.log(
    `\nFactories watched (${factories.length})` +
        (override ? ", from ALEA_FACTORIES" : ", from the router"),
);
for (const f of factories) console.log(`  ${f}`);
if (factories.length === 0) {
    console.log("  none. Nothing will be found, whoever names this provider.");
}

console.log("\nGenerators this provider serves");
const generators = await generatorsServed();
if (generators.length === 0) {
    console.log("  none. A generator names its provider at deploy, or through set_provider.\n");
    process.exit(0);
}
for (const c of generators) console.log(`  ${c}`);

console.log("\nPieces waiting");
let total = 0;
for (const generator of generators) {
    const waiting = await pendingIn(generator).catch((e: unknown) => {
        console.log(`  ${generator}  scan failed: ${e instanceof Error ? e.message : e}`);
        return [];
    });
    if (waiting.length === 0) {
        console.log(`  ${generator}  nothing waiting`);
        continue;
    }
    for (const piece of waiting) {
        total++;
        console.log(`  ${piece.generator} #${piece.tokenId}  seed ${piece.seed.slice(0, 12)}…`);
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
