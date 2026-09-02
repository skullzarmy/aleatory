/**
 * Whether a royalty recipient can actually be paid.
 *
 * The marketplace asks `sp.contract(sp.unit, recipient)` before it sends, so a
 * recipient it cannot reach is skipped and its share goes to the seller. The
 * collection stays sellable and that address is never paid again, on any sale,
 * with no setter to correct it. This route is what tells the artist while the
 * address is still editable, so what it must never do is answer "payable" for
 * something the contract will skip.
 *
 * The address checks run without a network. The rest needs a chain, and is
 * skipped offline rather than failing.
 *
 * Run: npm test
 */

import { GET } from "@/app/api/payable/route";

let failures = 0;

function check(name: string, ok: boolean, detail?: string) {
    if (ok) {
        console.log(`  ok   ${name}`);
    } else {
        failures++;
        console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
    }
}

const ask = (address: string, source = "") =>
    GET(new Request(`http://local/api/payable?${new URLSearchParams({ address, source })}`));

/** Funded on shadownet, so a simulation from it is not rejected for an empty source. */
const SOURCE = "tz1ahmJWEYzt5k1bhyBfvxTwCAS8h1Gobw5V";
/** Twelve entrypoints and no default: the shape the contract skips. */
const NO_DEFAULT = "KT1FcUZAsMihzHX2pAHpCDqUmMSEjhqmxfmQ";

async function verdictOf(address: string, source = "") {
    const res = await ask(address, source);
    return (await res.json()) as { verdict?: string; why?: string };
}

async function run() {
    console.log("\nRoyalty recipients\n");

    // Implicit accounts cannot refuse tez, and answering takes no network.
    for (const prefix of ["tz1", "tz2", "tz3", "tz4"]) {
        const address = `${prefix}ahmJWEYzt5k1bhyBfvxTwCAS8h1Gobw5V`;
        const body = await verdictOf(address);
        check(
            `${prefix} is payable without asking the chain`,
            body.verdict === "payable",
            body.verdict,
        );
    }

    for (const [name, address] of [
        ["an empty address", ""],
        ["a truncated KT1", "KT1FcUZ"],
        ["something that is not an address", "https://evil.example"],
    ] as const) {
        const res = await ask(address);
        check(`${name} is refused`, res.status === 400, `got ${res.status}`);
    }

    let online = true;
    try {
        await fetch("https://api.shadownet.tzkt.io/v1/head", { method: "HEAD" });
    } catch {
        online = false;
    }

    if (!online) {
        console.log("  skip chain checks, no connection\n");
    } else {
        // The case that matters: a contract with no default entrypoint. The
        // marketplace skips it, so this must not come back payable.
        const skipped = await verdictOf(NO_DEFAULT, SOURCE);
        check(
            "a contract with no default entrypoint is not called payable",
            skipped.verdict === "skipped",
            `${skipped.verdict}: ${skipped.why}`,
        );

        // With no source there is nothing to simulate from, and the entrypoint
        // answer still has to stand on its own.
        const sourceless = await verdictOf(NO_DEFAULT);
        check(
            "and is still not payable when there is nothing to simulate from",
            sourceless.verdict === "skipped",
            `${sourceless.verdict}: ${sourceless.why}`,
        );

        // A contract that does not exist cannot be confirmed, and saying so is
        // the honest answer. Answering "payable" here would be the bad one.
        const absent = await verdictOf("KT1XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX", SOURCE);
        check(
            "an address that is not a contract is never called payable",
            absent.verdict !== "payable",
            `${absent.verdict}: ${absent.why}`,
        );
    }

    console.log(
        failures === 0
            ? "\nNothing the marketplace would skip is reported as payable.\n"
            : `\n${failures} check(s) failed.\n`,
    );
    process.exit(failures === 0 ? 0 : 1);
}

run().catch((e) => {
    console.error("\nThe suite could not run:", e instanceof Error ? e.message : e);
    process.exit(1);
});
