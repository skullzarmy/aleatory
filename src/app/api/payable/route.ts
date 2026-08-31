import { NextResponse } from "next/server";
import { rpcUrl, tzktApi } from "@/lib/config";

/**
 * Can this address be paid a royalty?
 *
 * The marketplace pays each share inside the sale, and it asks first:
 * `sp.contract(sp.unit, recipient)` is Some for every implicit account and for
 * a contract with a `default` entrypoint of type unit. A share it cannot
 * deliver goes to the seller. `royalties` has no setter, so an address that
 * cannot be paid is never paid, on any sale, for the life of the collection,
 * and the artist cannot correct it afterwards. This page is the last moment
 * it is still editable, which is the whole reason to ask.
 *
 * Two questions, because they have different answers.
 *
 * Whether a `default` of the right type exists is answered by reading the
 * contract's entrypoints, and that is the same question the marketplace asks.
 * Whether that entrypoint then runs is answered by simulating the transfer,
 * and nothing on chain can answer it: an internal operation that fails reverts
 * the whole sale, so a recipient that takes the money and then throws makes
 * every sale of the collection fail permanently. Only a simulation sees that
 * one coming.
 *
 * Server side, so no visitor's address reaches the RPC from their own browser,
 * the same reason `api/dep` exists.
 */

const IMPLICIT = /^tz[1234][0-9A-Za-z]{33}$/;
const ORIGINATED = /^KT1[0-9A-Za-z]{33}$/;

/** run_operation checks the shape of a signature and never its validity. */
const UNCHECKED_SIGNATURE =
    "edsigtXomBKi5CTRf5cjATJWSyaRvhfYNHqSUGrn4SdbYRcGwQrUGjzEfQDTuqHhuA8b2d8NarZjz8TRf65WkpQmo423BtomS8Q";

export type Verdict = "payable" | "skipped" | "reverts" | "unknown";

export interface Payability {
    address: string;
    verdict: Verdict;
    why: string;
}

const answer = (body: Payability) => NextResponse.json(body);

/** The `default` entrypoint's parameter type, or null when there is none. */
async function defaultParameter(address: string): Promise<string | null> {
    const res = await fetch(`${tzktApi()}/v1/contracts/${address}/entrypoints`);
    if (!res.ok) throw new Error(`entrypoints answered ${res.status}`);
    const entrypoints = (await res.json()) as {
        name: string;
        jsonParameters?: Record<string, unknown>;
    }[];
    const found = entrypoints.find((e) => e.name === "default");
    if (!found) return null;
    // TzKT names the type in the key: {"schema:unit": "unit"}.
    const key = Object.keys(found.jsonParameters ?? {})[0] ?? "";
    return key.replace(/^schema:/, "") || "unit";
}

/**
 * One mutez to the address, run against the node and never signed.
 *
 * The source is the artist's own account, so it is funded (they are about to
 * pay for an origination) and nothing here depends on an address of ours
 * holding a balance. The storage allowance covers allocating an implicit
 * account, which is charged even on a simulation.
 */
async function simulate(address: string, source: string): Promise<{ ok: boolean; why: string }> {
    const rpc = rpcUrl();
    const read = async (path: string) => {
        const res = await fetch(`${rpc}${path}`);
        if (!res.ok) throw new Error(`${path} answered ${res.status}`);
        return res.json();
    };

    const [branch, chainId, counter] = await Promise.all([
        read("/chains/main/blocks/head/hash"),
        read("/chains/main/chain_id"),
        read(`/chains/main/blocks/head/context/contracts/${source}/counter`),
    ]);

    const res = await fetch(`${rpc}/chains/main/blocks/head/helpers/scripts/run_operation`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            operation: {
                branch,
                contents: [
                    {
                        kind: "transaction",
                        source,
                        fee: "0",
                        counter: String(Number(counter) + 1),
                        gas_limit: "100000",
                        storage_limit: "500",
                        amount: "1",
                        destination: address,
                    },
                ],
                signature: UNCHECKED_SIGNATURE,
            },
            chain_id: chainId,
        }),
    });

    if (!res.ok) throw new Error(`the node refused the simulation (${res.status})`);
    const body = (await res.json()) as {
        contents?: { metadata?: { operation_result?: { status?: string; errors?: { id?: string }[] } } }[];
    };
    const result = body.contents?.[0]?.metadata?.operation_result;
    if (result?.status === "applied") return { ok: true, why: "" };

    const ids = (result?.errors ?? [])
        .map((e) => (e.id ?? "").split(".").slice(2).join("."))
        .filter(Boolean);
    return { ok: false, why: ids[0] || result?.status || "the transfer did not apply" };
}

export async function GET(request: Request) {
    const params = new URL(request.url).searchParams;
    const address = params.get("address") ?? "";
    const source = params.get("source") ?? "";

    if (IMPLICIT.test(address)) {
        return answer({ address, verdict: "payable", why: "an implicit account cannot refuse tez" });
    }
    if (!ORIGINATED.test(address)) {
        return NextResponse.json({ error: "not a Tezos address" }, { status: 400 });
    }

    let parameter: string | null;
    try {
        parameter = await defaultParameter(address);
    } catch (e) {
        return answer({
            address,
            verdict: "unknown",
            why: e instanceof Error ? e.message : "the contract could not be read",
        });
    }

    if (parameter === null) {
        return answer({
            address,
            verdict: "skipped",
            why: "it is a contract with no default entrypoint",
        });
    }
    if (parameter !== "unit") {
        return answer({
            address,
            verdict: "skipped",
            why: `its default entrypoint takes ${parameter}, and a royalty is paid as a plain transfer`,
        });
    }

    if (!IMPLICIT.test(source)) {
        return answer({
            address,
            verdict: "payable",
            why: "it has a default entrypoint that takes a plain transfer",
        });
    }

    try {
        const run = await simulate(address, source);
        return answer(
            run.ok
                ? { address, verdict: "payable", why: "a transfer to it applies" }
                : { address, verdict: "reverts", why: run.why },
        );
    } catch (e) {
        return answer({
            address,
            verdict: "unknown",
            why: e instanceof Error ? e.message : "the transfer could not be simulated",
        });
    }
}
