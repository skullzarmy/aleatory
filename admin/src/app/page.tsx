import {
    fetchAgent,
    fetchFactory,
    fetchMarketplace,
    fetchProvider,
    fetchProviderAddresses,
    fetchResolver,
    fetchRouter,
} from "@/lib/chain";
import { ADDRESSES } from "@/lib/config";
import { bps, tez } from "@/lib/format";
import { Addr, Card, Row, Stat } from "@/components/Bits";
import { Action } from "@/components/Action";
import { LiveRefresh } from "@/components/LiveRefresh";
import { Amount } from "@/components/Amount";
import {
    claimRoyalties,
    deregisterProvider,
    registerProvider,
    removeWriter,
    setFactoryPaused,
    setMarketplacePaused,
    withdrawFactoryFees,
    withdrawMarketplaceFees,
} from "@/lib/ops";
import { AddToList, Setting } from "@/components/Setting";
import { Handover, type Administered } from "@/components/Handover";

const pick = (c: { address: string; administrator: string; proposedAdmin: string | null }) => ({
    address: c.address,
    administrator: c.administrator,
    proposedAdmin: c.proposedAdmin,
});

// Balances are the entire point. Nothing here is cached.
export const dynamic = "force-dynamic";

export default async function Dashboard() {
    const router = await fetchRouter().catch(() => null);

    // Addresses come from the router wherever it has them. An env var records
    // what was true when it was set; the router records what the contracts
    // resolve to now.
    const [marketplace, factory, provider, agent, resolver] = await Promise.all([
        fetchMarketplace(router?.marketplace || ADDRESSES.marketplace).catch(() => null),
        fetchFactory(router?.currentFactory || ADDRESSES.factory).catch(() => null),
        fetchProvider(ADDRESSES.provider).catch(() => null),
        fetchAgent(ADDRESSES.agent).catch(() => null),
        fetchResolver(router?.resolver || ADDRESSES.resolver).catch(() => null),
    ]);

    const registry = router?.registry || ADDRESSES.registry;
    const registered = await fetchProviderAddresses(registry)
        .then((all) => all.includes(ADDRESSES.provider))
        .catch(() => null);

    // Only the contracts that actually answered. A handover control for
    // something that could not be read is a control that cannot be trusted.
    const administered: Administered[] = [
        marketplace && { name: "Marketplace", ...pick(marketplace) },
        factory && { name: "Factory", ...pick(factory) },
        router && { name: "Router", ...pick(router) },
        resolver && { name: "Resolver", ...pick(resolver) },
    ].filter(Boolean) as Administered[];

    const claimable =
        (marketplace?.feesAccrued ?? 0) + (factory?.feesAccrued ?? 0);

    return (
        <div className="space-y-8">
            <LiveRefresh seconds={30} />

            <section>
                <h1 className="mb-4 text-xl font-semibold tracking-tight">Treasury</h1>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <Stat
                        label="Sweepable now"
                        value={tez(claimable)}
                        tone={claimable > 0 ? "ok" : "plain"}
                        note="Fees on the marketplace and factory"
                    />
                    <Stat
                        label="Render gas held"
                        value={provider ? tez(provider.balance) : "—"}
                        note={provider ? "Operator key to withdraw" : "No provider configured"}
                    />
                    <Stat
                        label="Owed to artists"
                        value={marketplace ? tez(marketplace.royaltiesOwed) : "—"}
                        note="Unclaimed royalties, not ours"
                    />
                    <Stat
                        label="Daemon key"
                        value={agent ? tez(agent.balance) : "—"}
                        tone={agent?.low ? "bad" : "plain"}
                        note={
                            agent?.low
                                ? "Low. Publishing stops silently when this empties."
                                : agent
                                  ? "Pays gas to publish token metadata"
                                  : "No agent configured"
                        }
                    />
                </div>
            </section>

            {marketplace && (
                <Card
                    title="Marketplace"
                    subtitle="Holds three different people's money at once, so the balance alone tells you nothing."
                >
                    <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                            <Row label="Contract balance">{tez(marketplace.balance)}</Row>
                            <Row label="Platform fees accrued">
                                {tez(marketplace.feesAccrued)}
                            </Row>
                            <Row label="Royalties owed out">
                                {tez(marketplace.royaltiesOwed)}
                            </Row>
                            <Row label={`Escrowed in ${marketplace.activeOffers} offer(s)`}>
                                {tez(marketplace.escrowed)}
                            </Row>
                            <Row label="Unaccounted for">
                                <span
                                    className={
                                        marketplace.unaccounted === 0 ? "text-ok" : "text-bad"
                                    }
                                >
                                    {tez(marketplace.unaccounted)}
                                    {marketplace.unaccounted === 0 && " ✓"}
                                </span>
                            </Row>
                        </div>
                        <div>
                            <Row label="Fee">{bps(marketplace.feeBps)}</Row>
                            <Row label="Treasury">
                                <Addr address={marketplace.treasury} />
                            </Row>
                            <Row label="Administrator">
                                <Addr address={marketplace.administrator} />
                            </Row>
                            <Row label="Trading">
                                {marketplace.paused ? (
                                    <span className="text-warn">paused</span>
                                ) : (
                                    <span className="text-ok">open</span>
                                )}
                            </Row>
                            <Row label="Active listings">{marketplace.activeListings}</Row>
                        </div>
                    </div>

                    {marketplace.unaccounted !== 0 && (
                        <p className="rounded border border-bad/40 bg-bad/5 p-3 text-sm">
                            {marketplace.unaccounted > 0
                                ? "The contract holds more than anything accounts for. Tez arrived that no fee, royalty or offer explains."
                                : "The contract has promised more than it holds. A claim or a cancelled offer is going to fail."}
                        </p>
                    )}

                    <div className="space-y-3 border-t border-line pt-4">
                        <Action
                            op={withdrawMarketplaceFees(marketplace.address)}
                            unavailable={
                                marketplace.feesAccrued === 0
                                    ? "No fees accrued to sweep."
                                    : undefined
                            }
                        />
                        <Action
                            op={setMarketplacePaused(marketplace.address, !marketplace.paused)}
                            holder={marketplace.administrator}
                        />
                    </div>

                    <div className="space-y-4 border-t border-line pt-4">
                        <Setting
                            label="Fee"
                            help="Charged on each sale. Never retroactive: live listings and offers settle on the fee they were created with."
                            kind="bps"
                            current={marketplace.feeBps}
                            holder={marketplace.administrator}
                            setter="fee"
                            contract={marketplace.address}
                        />
                        <Setting
                            label="Treasury"
                            help="Where a sweep sends fees. Fees accrue rather than forward during a sale, so an address that rejects transfers cannot break trading."
                            kind="address"
                            current={marketplace.treasury}
                            holder={marketplace.administrator}
                            setter="marketplaceTreasury"
                            contract={marketplace.address}
                        />
                    </div>

                    {marketplace.royaltyRows.length > 0 && (
                        <div className="border-t border-line pt-4">
                            <p className="label mb-2">Unclaimed royalties</p>
                            <p className="mb-3 text-xs text-dim">
                                Claiming is permissionless and pays the recipient, so you can
                                settle these on an artist&rsquo;s behalf.
                            </p>
                            <ul className="space-y-3">
                                {marketplace.royaltyRows.map((r) => (
                                    <li key={r.recipient} className="flex flex-wrap items-center gap-3">
                                        <Addr address={r.recipient} />
                                        <span className="text-sm">{tez(r.mutez)}</span>
                                        <Action op={claimRoyalties(marketplace.address, r.recipient)} />
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </Card>
            )}

            {factory && (
                <Card title="Factory" subtitle="Deploy fees, and the collections it has made.">
                    <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                            <Row label="Address">
                                <Addr address={factory.address} />
                            </Row>
                            <Row label="Balance">{tez(factory.balance)}</Row>
                            <Row label="Fees accrued">{tez(factory.feesAccrued)}</Row>
                            <Row label="Unaccounted for">
                                <span className={factory.unaccounted === 0 ? "text-ok" : "text-bad"}>
                                    {tez(factory.unaccounted)}
                                    {factory.unaccounted === 0 && " ✓"}
                                </span>
                            </Row>
                        </div>
                        <div>
                            <Row label="Deploy price">{tez(factory.deployPrice)}</Row>
                            <Row label="Collections deployed">{factory.collections}</Row>
                            <Row label="Treasury">
                                <Addr address={factory.treasury} />
                            </Row>
                            <Row label="Deploys">
                                {factory.paused ? (
                                    <span className="text-warn">paused</span>
                                ) : (
                                    <span className="text-ok">open</span>
                                )}
                            </Row>
                        </div>
                    </div>
                    <div className="space-y-4 border-t border-line pt-4">
                        <Action
                            op={withdrawFactoryFees(factory.address)}
                            unavailable={
                                factory.feesAccrued === 0
                                    ? "No deploy fees accrued to sweep."
                                    : undefined
                            }
                        />
                        <Action
                            op={setFactoryPaused(factory.address, !factory.paused)}
                            holder={factory.administrator}
                        />
                        <Setting
                            label="Treasury"
                            kind="address"
                            current={factory.treasury}
                            holder={factory.administrator}
                            setter="factoryTreasury"
                            contract={factory.address}
                        />
                        <Setting
                            label="Deploy price"
                            help="What an artist pays to deploy a collection, on top of the storage the chain charges them."
                            kind="mutez"
                            current={factory.deployPrice}
                            holder={factory.administrator}
                            setter="deployPrice"
                            contract={factory.address}
                        />
                        <Setting
                            label="Resolver"
                            help="The resolver new collections are given. Existing ones keep the one they were deployed with."
                            kind="address"
                            current={factory.resolver}
                            holder={factory.administrator}
                            setter="factoryResolver"
                            contract={factory.address}
                        />
                    </div>
                </Card>
            )}

            <ProviderCard provider={provider} registry={registry} registered={registered} />

            {router && (
                <Card
                    title="Router"
                    subtitle="What every part of the platform resolves to. Wrong here means wrong everywhere."
                >
                    <Row label="Address">
                        <Addr address={router.address} />
                    </Row>
                    <Row label="Current factory">
                        <Addr address={router.currentFactory} />
                    </Row>
                    <Row label="Marketplace">
                        <Addr address={router.marketplace} />
                    </Row>
                    <Row label="Registry">
                        <Addr address={router.registry} />
                    </Row>
                    <Row label="Resolver">
                        <Addr address={router.resolver} />
                    </Row>
                    <Row label="Administrator">
                        <Addr address={router.administrator} />
                    </Row>
                    {router.proposedAdmin && (
                        <Row label="Admin proposed to">
                            <Addr address={router.proposedAdmin} />
                        </Row>
                    )}
                    <p className="text-xs text-dim">
                        {router.factories.length} factories registered. Only the last is live;
                        the rest stay so collections they deployed remain resolvable.
                    </p>

                    <div className="space-y-4 border-t border-line pt-4">
                        <AddToList
                            label="Add a factory"
                            help="Appends, and the newest becomes the one new deploys use. Nothing is removed, so collections keep resolving through the factory that made them."
                            holder={router.administrator}
                            setter="addFactory"
                            contract={router.address}
                        />
                        <Setting
                            label="Marketplace"
                            kind="address"
                            current={router.marketplace}
                            holder={router.administrator}
                            setter="routerMarketplace"
                            contract={router.address}
                        />
                        <Setting
                            label="Registry"
                            kind="address"
                            current={router.registry}
                            holder={router.administrator}
                            setter="routerRegistry"
                            contract={router.address}
                        />
                        <Setting
                            label="Resolver"
                            kind="address"
                            current={router.resolver}
                            holder={router.administrator}
                            setter="routerResolver"
                            contract={router.address}
                        />
                    </div>
                </Card>
            )}

            {resolver && (
                <Card
                    title="Resolver"
                    subtitle="Who may write resolution entries. The other half of revoking a leaked daemon key."
                >
                    <Row label="Address">
                        <Addr address={resolver.address} />
                    </Row>
                    <Row label="Administrator">
                        <Addr address={resolver.administrator} />
                    </Row>

                    <div className="space-y-3 border-t border-line pt-4">
                        <p className="label">Writers</p>
                        {resolver.writers.length === 0 ? (
                            <p className="text-sm text-dim">None. Nothing can write entries.</p>
                        ) : (
                            <ul className="space-y-3">
                                {resolver.writers.map((w) => (
                                    <li key={w} className="flex flex-wrap items-center gap-3">
                                        <Addr address={w} />
                                        {w === provider?.agent && (
                                            <span className="text-xs text-dim">
                                                the current render agent
                                            </span>
                                        )}
                                        <Action
                                            op={removeWriter(resolver.address, w)}
                                            holder={resolver.administrator}
                                        />
                                    </li>
                                ))}
                            </ul>
                        )}
                        <AddToList
                            label="Add a writer"
                            holder={resolver.administrator}
                            setter="addWriter"
                            contract={resolver.address}
                        />
                    </div>
                </Card>
            )}

            {administered.length > 0 && (
                <Card
                    title="Administration"
                    subtitle="Two steps everywhere, and each contract moves on its own."
                >
                    <Handover contracts={administered} />
                </Card>
            )}
        </div>
    );
}

function ProviderCard({
    provider,
    registry,
    registered,
}: {
    provider: Awaited<ReturnType<typeof fetchProvider>>;
    registry: string;
    /** null when the registry could not be read, which is not the same as false. */
    registered: boolean | null;
}) {
    if (!provider) {
        return (
            <Card title="Render provider" subtitle="Not configured.">
                <p className="text-sm text-dim">
                    Set <code className="font-mono">NEXT_PUBLIC_PROVIDER_ADDRESS</code> to the
                    KT1 of the provider you operate.
                </p>
            </Card>
        );
    }

    return (
        <Card
            title="Render provider"
            subtitle="The one place here where a signature can send money somewhere of its choosing."
        >
            <div className="grid gap-3 sm:grid-cols-2">
                <div>
                    <Row label="Address">
                        <Addr address={provider.address} />
                    </Row>
                    <Row label="Render gas held">{tez(provider.balance)}</Row>
                    <Row label="Charged per mint">{tez(provider.renderGas)}</Row>
                </div>
                <div>
                    <Row label="Operator">
                        <Addr address={provider.operator} />
                    </Row>
                    <Row label="Agent key">
                        <Addr address={provider.agent} />
                    </Row>
                </div>
            </div>

            <div className="space-y-4 border-t border-line pt-4">
                <Amount
                    kind="withdraw"
                    provider={provider.address}
                    max={provider.balance}
                    operator={provider.operator}
                    defaultTo={provider.operator}
                />
                <Amount
                    kind="render-gas"
                    provider={provider.address}
                    current={provider.renderGas}
                    operator={provider.operator}
                />
                <Amount
                    kind="agent"
                    provider={provider.address}
                    current={provider.agent}
                    operator={provider.operator}
                />

                {registry && registered !== null && (
                    <div className="space-y-2 border-t border-line pt-4">
                        <p className="label">Registry listing</p>
                        <p className="text-xs text-dim">
                            {registered
                                ? "Listed, so artists can pick this provider."
                                : "Not listed. Artists cannot pick this provider."}
                        </p>
                        <Action
                            op={
                                registered
                                    ? deregisterProvider(registry, provider.address)
                                    : registerProvider(registry, provider.address)
                            }
                            holder={provider.operator}
                        />
                    </div>
                )}
            </div>
        </Card>
    );
}
