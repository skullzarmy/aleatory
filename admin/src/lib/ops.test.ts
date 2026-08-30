/**
 * Does an operation encode to what the contract actually expects?
 *
 * The failure this exists to catch has already happened once on this project.
 * SmartPy lays a record's fields out alphabetically rather than in the order
 * they are declared, so an encoder that goes by position can put the price
 * where the token id belongs and produce a perfectly valid operation that does
 * the wrong thing. It cost a live `list_token` that reverted with
 * FA2_TOKEN_UNDEFINED, and it was invisible in every unit test that did not
 * compare against the deployed contract's own types.
 *
 * So these read the deployed contracts' real parameter schemas, which means
 * the suite needs a network and a configured environment. That is the price of
 * it testing the thing that actually broke.
 *
 * Every address is resolved the way the console resolves it, from the router.
 * Writing them down here would pin the suite to whichever deployment was live
 * on the day it was written, and on a platform that redeploys its factory that
 * is a test which passes against contracts nobody uses any more.
 *
 * Run: npm test
 */

import { fetchProviderAddresses, fetchRouter } from "./chain";
import { ADDRESSES, NETWORK } from "./config";
import {
    acceptAdmin,
    addFactory,
    addWriter,
    encode,
    proposeAdmin,
    removeWriter,
    setAgent,
    setFactoryTreasury,
    setFee,
    setMarketplacePaused,
    setMarketplaceTreasury,
    setRenderGas,
    setDeployPrice,
    setFactoryPaused,
    setFactoryResolver,
    setProviderMetadata,
    setRouterMarketplace,
    setRouterRegistry,
    setRouterResolver,
    registerProvider,
    deregisterProvider,
    withdrawFactoryFees,
    withdrawMarketplaceFees,
    withdrawRenderGas,
} from "./ops";

let failures = 0;

function check(name: string, condition: boolean | undefined, detail?: unknown) {
    if (condition === true) {
        console.log(`  ok   ${name}`);
    } else {
        failures++;
        console.log(`  FAIL ${name}`);
        if (detail !== undefined) console.log(`       ${JSON.stringify(detail)}`);
    }
}

/**
 * Where to aim each call.
 *
 * The marketplace comes from the router, because the router is what the
 * contracts themselves believe. The provider is whichever one this operator
 * runs, falling back to any registered provider: the encoding under test is a
 * property of the interface, and every provider implements the same one.
 */
async function resolveTargets() {
    const router = await fetchRouter();
    if (!router) {
        throw new Error(
            "NEXT_PUBLIC_ROUTER_ADDRESS is not set. Copy .env.example to .env and fill it in.",
        );
    }

    let provider = ADDRESSES.provider;
    if (!provider) [provider] = await fetchProviderAddresses(router.registry);
    if (!provider) {
        throw new Error(
            `No provider is registered on ${NETWORK} and NEXT_PUBLIC_PROVIDER_ADDRESS is not set.`,
        );
    }

    return {
        router,
        marketplace: router.marketplace,
        factory: router.currentFactory,
        resolver: router.resolver,
        provider,
    };
}

async function run() {
    const { router, marketplace, factory, resolver, provider } = await resolveTargets();

    console.log(`\nOperation encoding (${NETWORK})`);
    console.log(`  marketplace ${marketplace}`);
    console.log(`  provider    ${provider}\n`);

    // The two-field entrypoint, and the whole reason for named arguments.
    // `withdraw(amount, to_)` is a pair, and getting the two the wrong way
    // round would send an address-shaped thing as an amount, or silently
    // withdraw a different number than was asked for.
    {
        const { entrypoint, value } = await encode(withdrawRenderGas(provider, 1_234_567, marketplace));
        const v = value as { args?: { int?: string }[] };
        check("withdraw targets the right entrypoint", entrypoint === "withdraw", entrypoint);
        check(
            "withdraw encodes the amount as the amount",
            v.args?.some((a) => a.int === "1234567"),
            value,
        );
        check(
            "withdraw encodes the destination as the destination",
            JSON.stringify(value).includes(marketplace),
            value,
        );
    }

    // Single-argument entrypoints, where the value is the argument itself.
    {
        const { entrypoint, value } = await encode(setRenderGas(provider, 50_000));
        check("set_render_gas targets the right entrypoint", entrypoint === "set_render_gas");
        check("set_render_gas carries the mutez", JSON.stringify(value).includes("50000"), value);
    }

    {
        const { entrypoint, value } = await encode(setFee(marketplace, 250));
        check("set_fee targets the right entrypoint", entrypoint === "set_fee");
        check("set_fee carries the bps", JSON.stringify(value).includes("250"), value);
    }

    // Entrypoints taking unit. A one-element array reaches Taquito as a scalar
    // mismatch and throws at send time, which is the worst moment to find out,
    // so every argument shape gets exercised here.
    {
        const { entrypoint } = await encode(withdrawMarketplaceFees(marketplace));
        check("withdraw_fees encodes with no argument", entrypoint === "withdraw_fees");
    }

    {
        const { entrypoint } = await encode(acceptAdmin(marketplace));
        check("accept_admin encodes with no argument", entrypoint === "accept_admin");
    }

    {
        const { entrypoint, value } = await encode(setMarketplacePaused(marketplace, true));
        check("set_paused targets the right entrypoint", entrypoint === "set_paused");
        check("set_paused carries a bool", JSON.stringify(value).includes("True"), value);
    }

    {
        const who = router.administrator;
        const { entrypoint, value } = await encode(proposeAdmin(marketplace, who));
        check("propose_admin targets the right entrypoint", entrypoint === "propose_admin");
        check("propose_admin carries the address", JSON.stringify(value).includes(who), value);
    }

    // The remaining entrypoints the console can send. Every one of them is a
    // button somewhere, so every one is encoded here.
    {
        const who = router.administrator;
        for (const [name, op] of [
            ["set_treasury (marketplace)", setMarketplaceTreasury(marketplace, who)],
            ["set_treasury (factory)", setFactoryTreasury(factory, who)],
            ["withdraw_fees (factory)", withdrawFactoryFees(factory)],
            ["add_factory", addFactory(router.address, factory)],
            ["set_marketplace", setRouterMarketplace(router.address, marketplace)],
            ["set_registry", setRouterRegistry(router.address, router.registry)],
            ["set_resolver", setRouterResolver(router.address, resolver)],
            ["add_writer", addWriter(resolver, who)],
            ["remove_writer", removeWriter(resolver, who)],
            ["set_agent", setAgent(provider, who)],
            ["set_paused (factory)", setFactoryPaused(factory, true)],
            ["set_deploy_price", setDeployPrice(factory, 1_000_000)],
            ["set_resolver (factory)", setFactoryResolver(factory, resolver)],
            ["set_metadata", setProviderMetadata(provider, "", "ipfs://x")],
            ["register", registerProvider(router.registry, provider)],
            ["deregister", deregisterProvider(router.registry, provider)],
        ] as const) {
            const { entrypoint } = await encode(op);
            check(`${name} encodes`, entrypoint === op.entrypoint, entrypoint);
        }
    }

    // An entrypoint that does not exist should be refused here rather than by
    // a wallet, which reports it as an unhelpful simulation failure.
    {
        let threw = false;
        try {
            await encode({
                label: "nonsense",
                to: marketplace,
                entrypoint: "definitely_not_an_entrypoint",
                args: null,
                authority: "admin",
            });
        } catch {
            threw = true;
        }
        check("an unknown entrypoint is refused before signing", threw);
    }

    console.log(
        failures === 0
            ? "\nEvery operation encodes against the deployed contract.\n"
            : `\n${failures} check(s) failed.\n`,
    );
    process.exit(failures === 0 ? 0 : 1);
}

run().catch((e) => {
    console.error("\nThe suite could not run:", e instanceof Error ? e.message : e);
    process.exit(1);
});
