/**
 * The indexer queries, run against the indexer.
 *
 * Every other test in this repository reads source text. That is enough to
 * stop a bug coming back and no use at all at catching a new one: a check that
 * `/v1/operations/${hash}` appears in `ops.ts` would have passed just as
 * happily for the URL that was wrong, because the check is written after the
 * URL and to match it.
 *
 * Two of those shipped. `/v1/operations/originations?hash=` has no `hash`
 * filter and returned the whole table, whose first row was offered an artist's
 * code. `?select=creator` on a contract is not supported either and returns the
 * whole record, whose own `address` is the contract being asked about, so every
 * real generator failed the check meant to protect it.
 *
 * Neither is a mistake in reasoning. TzKT answers 200 to a parameter it does
 * not implement and quietly ignores it, so the only way to know a filter
 * filters is to send it and count.
 *
 * Reads only. Nothing here signs anything or costs anything.
 *
 * Run: npx tsx src/lib/indexer.test.ts
 */

async function main() {
    const API = process.env.NEXT_PUBLIC_TZKT_API ?? "https://api.shadownet.tzkt.io";
    const ROUTER = process.env.NEXT_PUBLIC_ROUTER_ADDRESS ?? "KT1LWD8kiuyVzkSUAHKVovw6ymsjHcKykADc";

    let failed = 0;
    function check(what: string, ok: boolean, why = "") {
        console.log(`  ${ok ? "ok  " : "FAIL"}   ${what}${ok || !why ? "" : `\n         ${why}`}`);
        if (!ok) failed++;
    }

    const get = (path: string) => fetch(`${API}${path}`).then((r) => r.json());

    console.log(`\nIndexer queries, against ${API}\n`);

    // --- the router, and a generator to ask about ------------------------------
    const routerStorage = (await get(`/v1/contracts/${ROUTER}/storage`)) as {
        factories?: string[];
        marketplace?: string;
    };
    check(
        "the router's storage carries the fields the app reads",
        Array.isArray(routerStorage.factories) && typeof routerStorage.marketplace === "string",
    );

    const factory = routerStorage.factories?.[0] ?? "";
    const made = (await get(`/v1/contracts?creator=${factory}&select=address&limit=1`)) as string[];
    const generator = made[0] ?? "";
    check("a generator exists to test against", Boolean(generator), `factory ${factory}`);

    // --- a filter that is not implemented is ignored, not refused ---------------
    //
    // The bug, stated as a property. Every filtered query below must return fewer
    // rows than the same query unfiltered, or the filter did nothing.
    const allOriginations = (await get("/v1/operations/originations?limit=100")) as unknown[];
    const filteredByHash = (await get(
        "/v1/operations/originations?hash=oohi2V8gxzBuaVmxfXwQjfkoYTsjerwWZLtHb6M11vpiJwaGFnq&limit=100",
    )) as unknown[];
    check(
        "originations has no hash filter, and ignoring it returns everything",
        allOriginations.length === filteredByHash.length,
        "if this ever starts filtering, the endpoint gained support and this note is stale",
    );

    // --- so the operation group is where a hash is answered ---------------------
    const group = (await get(
        "/v1/operations/oohi2V8gxzBuaVmxfXwQjfkoYTsjerwWZLtHb6M11vpiJwaGFnq",
    )) as { type?: string; originatedContract?: { address?: string } }[];
    const originated = group.find((r) => r.type === "origination")?.originatedContract?.address;
    check(
        "an operation group names the contract it originated",
        originated === "KT1ANdSGAgSdNhBE266eRvGudyeCEGRNJMV3",
        `got ${originated ?? "nothing"}`,
    );

    // --- the creator, which provenance is decided on ---------------------------
    const contract = (await get(`/v1/contracts/${generator}`)) as {
        address?: string;
        creator?: { address?: string };
    };
    check(
        "a contract names its creator, and it is not itself",
        Boolean(contract.creator?.address) && contract.creator?.address !== contract.address,
        "reading the record's own address as the creator makes every generator foreign",
    );
    check(
        "the creator of a generator is a factory the router lists",
        (routerStorage.factories ?? []).includes(contract.creator?.address ?? ""),
    );

    const selected = (await get(`/v1/contracts/${generator}?select=creator`)) as Record<
        string,
        unknown
    >;
    check(
        "select is ignored on a single contract, so the whole record comes back",
        "address" in selected && "creator" in selected,
        "asking for one field and being handed the record is how the wrong field got read",
    );

    // --- generator storage, which publishing and rendering both depend on ------
    const storage = (await get(`/v1/contracts/${generator}/storage`)) as {
        art?: { code?: string; code_sealed?: boolean; code_hash?: string; code_encoding?: string };
    };
    check(
        "a generator's storage carries the art fields",
        typeof storage.art?.code === "string" &&
            typeof storage.art?.code_sealed === "boolean" &&
            typeof storage.art?.code_encoding === "string",
    );

    const notAGenerator = (await get(`/v1/contracts/${ROUTER}/storage`)) as { art?: unknown };
    check(
        "a contract that is not a generator has no art to mistake for an empty one",
        notAGenerator.art === undefined,
    );

    console.log(
        failed === 0
            ? "\n  every query the app relies on answers the way it is read\n"
            : `\n  ${failed} failed\n`,
    );
    process.exit(failed === 0 ? 0 : 1);
}

void main();
