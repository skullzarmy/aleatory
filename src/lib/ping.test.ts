/**
 * Where a mint's push is allowed to go.
 *
 * The destination is read from a contract a stranger originated, and this
 * route is unauthenticated, so it is a server that fetches what it is told to
 * unless it refuses first. These are the refusals, run against the real route
 * with no network reached: every case below is rejected before any fetch.
 *
 * Run: npm test
 */

import { POST } from "@/app/api/render-ping/route";

let failures = 0;

function check(name: string, ok: boolean, detail?: string) {
    if (ok) {
        console.log(`  ok   ${name}`);
    } else {
        failures++;
        console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
    }
}

const ask = (body: unknown) =>
    POST(
        new Request("http://local/api/render-ping", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
        }),
    );

/** The route rate limits itself, so a suite has to outwait its own gap. */
const pause = () => new Promise((r) => setTimeout(r, 300));

async function refuses(name: string, body: unknown) {
    await pause();
    const res = await ask(body);
    const out = (await res.json()) as { pinged?: boolean };
    check(name, out.pinged === false, JSON.stringify(out));
}

async function run() {
    console.log("\nWhere a push may go\n");

    await refuses("no provider named", {});
    await refuses("a malformed address", { provider: "KT1nope" });
    await refuses("an implicit account", { provider: "tz1ahmJWEYzt5k1bhyBfvxTwCAS8h1Gobw5V" });
    // A well-formed KT1 that carries no endpoint. Reaches the chain and stops.
    await refuses("a contract advertising nothing", {
        provider: "KT1FcUZAsMihzHX2pAHpCDqUmMSEjhqmxfmQ",
    });

    // The gate itself. Started together rather than in sequence: awaiting the
    // first lets its chain read outlast the gap, so a sequential version of
    // this passes or fails on how quick the network was.
    await pause();
    const together = await Promise.all([
        ask({ provider: "KT1FcUZAsMihzHX2pAHpCDqUmMSEjhqmxfmQ" }),
        ask({ provider: "KT1FcUZAsMihzHX2pAHpCDqUmMSEjhqmxfmQ" }),
    ]);
    check(
        "a second call inside the gap is refused",
        together.some((r) => r.status === 429),
        together.map((r) => r.status).join(", "),
    );

    console.log(
        failures === 0
            ? "\nA push only leaves for an address the provider itself published.\n"
            : `\n${failures} check(s) failed.\n`,
    );
    process.exit(failures === 0 ? 0 : 1);
}

run().catch((e) => {
    console.error("\nThe suite could not run:", e instanceof Error ? e.message : e);
    process.exit(1);
});
