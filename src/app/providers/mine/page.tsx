"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { DAppClient } from "@tezos-x/octez.connect-sdk";
import { useWallet } from "@/context/WalletContext";
import { fetchOwnedProvider, fetchProvidersOperatedBy, type OwnedProvider } from "@/lib/providers";
import { useLive } from "@/components/LiveRefresh";
import {
    deregisterProvider,
    registerProvider,
    setAgent,
    setRenderGas,
    withdrawFromProvider,
} from "@/lib/ops";
import { BRAND, tzktLink } from "@/lib/config";
import { formatTez, parseTez, shortAddress } from "@/lib/utils";

/**
 * The operator's side of a render provider: list it, price it, rotate its key,
 * take the money out.
 *
 * Deploying the contract is not here. It is one origination from a terminal,
 * done once, and putting it in the browser would mean shipping the compiled
 * contract in the bundle and keeping the two in step. The guides below cover
 * it, and this page picks up at the address they hand back.
 */
export default function YourProviderPage() {
    const { address, connect, restoring, getClient } = useWallet();
    const [owned, setOwned] = useState<OwnedProvider[] | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    const [note, setNote] = useState<{ kind: "ok" | "bad"; text: string } | null>(null);

    const reload = useCallback(async () => {
        if (!address) return;
        setOwned(await fetchProvidersOperatedBy(address).catch(() => []));
    }, [address]);

    useLive(() => void reload(), 30);

    useEffect(() => {
        if (!address) {
            setOwned(null);
            return;
        }
        let cancelled = false;
        void (async () => {
            const rows = await fetchProvidersOperatedBy(address).catch(() => []);
            if (!cancelled) setOwned(rows);
        })();
        return () => {
            cancelled = true;
        };
    }, [address]);

    async function run(
        id: string,
        fn: (client: Awaited<ReturnType<typeof getClient>>) => Promise<{ hash: string }>,
    ) {
        setBusy(id);
        setNote(null);
        try {
            const client = await getClient();
            const { hash } = await fn(client);
            setNote({ kind: "ok", text: `Signed. ${hash.slice(0, 12)}…` });
            await reload();
        } catch (e) {
            setNote({
                kind: "bad",
                text: e instanceof Error ? e.message : "Your wallet cancelled that.",
            });
        } finally {
            setBusy(null);
        }
    }

    if (restoring) {
        return (
            <Shell>
                <p className="text-sm text-muted-foreground">Restoring your session…</p>
            </Shell>
        );
    }

    if (!address) {
        return (
            <Shell>
                <p className="text-sm text-muted-foreground">
                    Connect the wallet that administers your provider contract.
                </p>
                <button
                    type="button"
                    onClick={() => void connect()}
                    className="mt-4 rounded-md bg-alea-600 px-4 py-2 text-sm font-medium text-white hover:bg-alea-700"
                >
                    Connect
                </button>
                <Guides />
            </Shell>
        );
    }

    return (
        <Shell>
            {note && (
                <p
                    className={`mb-6 rounded-md border px-3 py-2 text-sm ${
                        note.kind === "ok"
                            ? "border-success/40 bg-success/10 text-success"
                            : "border-destructive/40 bg-destructive/10 text-destructive"
                    }`}
                >
                    {note.text}
                </p>
            )}

            {owned === null ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
            ) : owned.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                    Nothing registered to {shortAddress(address)}. Deploy a provider contract, then
                    list it below.
                </p>
            ) : (
                <ul className="space-y-6">
                    {owned.map((p) => (
                        <li key={p.address}>
                            <ProviderCard provider={p} busy={busy} onRun={run} operator={address} />
                        </li>
                    ))}
                </ul>
            )}

            <Listing operator={address} busy={busy} onRun={run} />
            <Guides />
        </Shell>
    );
}

type Run = (id: string, fn: (client: DAppClient) => Promise<{ hash: string }>) => Promise<void>;

function ProviderCard({
    provider: p,
    busy,
    onRun,
    operator,
}: {
    provider: OwnedProvider;
    busy: string | null;
    onRun: Run;
    operator: string;
}) {
    return (
        <div className="rounded-lg border border-border">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border px-4 py-3">
                <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                        {p.name || shortAddress(p.address)}
                    </p>
                    <a
                        href={tzktLink(p.address)}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono text-xs text-muted-foreground hover:text-foreground"
                    >
                        {shortAddress(p.address)}
                    </a>
                </div>
                <span
                    className={`text-xs font-medium ${
                        p.registered ? "text-success" : "text-warning"
                    }`}
                >
                    {p.registered ? "Listed" : "Not listed"}
                </span>
            </div>

            <div className="divide-y divide-border">
                <Field
                    label="Render gas"
                    hint="What a mint pays you per piece. A generator reads this live, so a change reaches every one of them at once."
                    initial={formatTez(p.renderGasMutez)}
                    suffix="ꜩ"
                    action="Set price"
                    busy={busy === `gas-${p.address}`}
                    onSubmit={(value) => {
                        const mutez = parseTez(value);
                        if (mutez === null) return "That is not an amount.";
                        void onRun(`gas-${p.address}`, (c) =>
                            setRenderGas(c, p.address, BigInt(mutez)),
                        );
                        return null;
                    }}
                />

                <Field
                    label="Agent"
                    hint="The key that signs set_token_metadata and nothing else. Rotating it here revokes the old one everywhere at once."
                    initial={p.agent}
                    mono
                    action="Set agent"
                    busy={busy === `agent-${p.address}`}
                    onSubmit={(value) => {
                        if (!/^(tz[1234])[A-Za-z0-9]{33}$/.test(value.trim())) {
                            return "That is not an implicit address.";
                        }
                        void onRun(`agent-${p.address}`, (c) =>
                            setAgent(c, p.address, value.trim()),
                        );
                        return null;
                    }}
                />

                <Withdraw provider={p} operator={operator} busy={busy} onRun={onRun} />

                <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <p className="text-xs text-muted-foreground">
                        {p.registered
                            ? "Delisting hides you from the directory. Generators already pointing at you keep paying you and keep being served."
                            : "Listing is free and permissionless. The registry checks the contract answers, which is a type check and not an endorsement."}
                    </p>
                    <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() =>
                            void onRun(`list-${p.address}`, (c) =>
                                p.registered
                                    ? deregisterProvider(c, p.address)
                                    : registerProvider(c, p.address),
                            )
                        }
                        className="shrink-0 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
                    >
                        {busy === `list-${p.address}`
                            ? "Signing…"
                            : p.registered
                              ? "Delist"
                              : "List in the registry"}
                    </button>
                </div>
            </div>
        </div>
    );
}

function Withdraw({
    provider: p,
    operator,
    busy,
    onRun,
}: {
    provider: OwnedProvider;
    operator: string;
    busy: string | null;
    onRun: Run;
}) {
    const [amount, setAmount] = useState("");
    const [to, setTo] = useState(operator);
    const [error, setError] = useState<string | null>(null);
    const id = `withdraw-${p.address}`;

    return (
        <div className="px-4 py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                <p className="text-sm font-medium">Balance</p>
                <p className="text-sm">{formatTez(p.balanceMutez)} ꜩ</p>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
                Render gas collects here. Only `withdraw` moves it, and only you can call it.
            </p>

            <div className="mt-3 flex flex-wrap gap-2">
                <input
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.0"
                    inputMode="decimal"
                    aria-label="Amount to withdraw, in tez"
                    className="w-28 rounded-md border border-border bg-background px-3 py-2 text-sm"
                />
                <input
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    aria-label="Address to withdraw to"
                    className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 font-mono text-sm"
                />
                <button
                    type="button"
                    disabled={busy !== null || p.balanceMutez === 0}
                    onClick={() => {
                        const mutez = parseTez(amount);
                        if (mutez === null || mutez <= 0) {
                            setError("That is not an amount.");
                            return;
                        }
                        if (mutez > p.balanceMutez) {
                            setError("More than the contract holds.");
                            return;
                        }
                        if (!/^(tz[1234]|KT1)[A-Za-z0-9]{33}$/.test(to.trim())) {
                            setError("That is not an address.");
                            return;
                        }
                        setError(null);
                        void onRun(id, (c) =>
                            withdrawFromProvider(c, p.address, BigInt(mutez), to.trim()),
                        );
                    }}
                    className="rounded-md border border-border px-3 py-2 text-sm hover:bg-accent disabled:opacity-50"
                >
                    {busy === id ? "Signing…" : "Withdraw"}
                </button>
            </div>
            {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
        </div>
    );
}

/** Listing a contract this page has not seen, which is every one before it is registered. */
function Listing({ operator, busy, onRun }: { operator: string; busy: string | null; onRun: Run }) {
    const [value, setValue] = useState("");
    const [checking, setChecking] = useState(false);
    const [error, setError] = useState<string | null>(null);

    return (
        <section className="mt-10 border-t border-border pt-6">
            <h2 className="text-sm font-medium">List a provider you deployed</h2>
            <p className="mt-1 text-xs text-muted-foreground">
                Paste the address the deploy printed. It is checked against the chain before your
                wallet opens, so an address that could never be listed is refused here.
            </p>

            <div className="mt-3 flex flex-wrap gap-2">
                <input
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder="KT1…"
                    aria-label="Provider contract address"
                    className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 font-mono text-sm"
                />
                <button
                    type="button"
                    disabled={busy !== null || checking}
                    onClick={() => {
                        void (async () => {
                            setError(null);
                            setChecking(true);
                            const found = await fetchOwnedProvider(value.trim()).catch(() => null);
                            setChecking(false);
                            if (!found) {
                                setError("Nothing at that address answers as a provider contract.");
                                return;
                            }
                            if (found.operator !== operator) {
                                setError(
                                    `That contract is administered by ${shortAddress(found.operator)}. Connect that wallet to manage it.`,
                                );
                                return;
                            }
                            if (found.registered) {
                                setError("That one is already listed.");
                                return;
                            }
                            void onRun("list-new", (c) => registerProvider(c, found.address));
                            setValue("");
                        })();
                    }}
                    className="rounded-md bg-alea-600 px-4 py-2 text-sm font-medium text-white hover:bg-alea-700 disabled:opacity-50"
                >
                    {checking ? "Checking…" : busy === "list-new" ? "Signing…" : "List it"}
                </button>
            </div>
            {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
        </section>
    );
}

function Guides() {
    return (
        <section className="mt-10 border-t border-border pt-6">
            <h2 className="text-sm font-medium">Deploying one</h2>
            <p className="mt-1 text-xs text-muted-foreground">
                One origination from a terminal, then the daemon that does the rendering. Neither
                needs anything from us.
            </p>
            <ul className="mt-3 space-y-2 text-sm">
                <li>
                    <a href="/docs/provider" className="hover:text-foreground hover:underline">
                        Running a render provider
                    </a>
                    <span className="text-xs text-muted-foreground">
                        {" "}
                        — what it costs, the two keys, and the environment
                    </span>
                </li>
                <li>
                    <Link href="/docs/interface" className="hover:text-foreground hover:underline">
                        ALEATORY-001
                    </Link>
                    <span className="text-xs text-muted-foreground">
                        {" "}
                        — what a renderer has to produce, if you write your own
                    </span>
                </li>
                <li>
                    <a
                        href={`${BRAND.url}/skill/aleatory-provider/SKILL.md`}
                        target="_blank"
                        rel="noreferrer"
                        className="hover:text-foreground hover:underline"
                    >
                        The provider skill
                    </a>
                    <span className="text-xs text-muted-foreground">
                        {" "}
                        — the same ground, for a coding agent
                    </span>
                </li>
            </ul>
        </section>
    );
}

function Field({
    label,
    hint,
    initial,
    suffix,
    mono,
    action,
    busy,
    onSubmit,
}: {
    label: string;
    hint: string;
    initial: string;
    suffix?: string;
    mono?: boolean;
    action: string;
    busy: boolean;
    onSubmit: (value: string) => string | null;
}) {
    const [value, setValue] = useState(initial);
    const [error, setError] = useState<string | null>(null);
    const dirty = value !== initial;

    // A price changed in another tab, or by the last signature, is the truth.
    useEffect(() => setValue(initial), [initial]);

    return (
        <div className="px-4 py-3">
            <p className="text-sm font-medium">{label}</p>
            <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
            <div className="mt-3 flex flex-wrap gap-2">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                    <input
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        aria-label={label}
                        className={`min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm ${
                            mono ? "font-mono" : ""
                        }`}
                    />
                    {suffix && <span className="text-sm text-muted-foreground">{suffix}</span>}
                </div>
                <button
                    type="button"
                    disabled={!dirty || busy}
                    onClick={() => setError(onSubmit(value))}
                    className="rounded-md border border-border px-3 py-2 text-sm hover:bg-accent disabled:opacity-50"
                >
                    {busy ? "Signing…" : action}
                </button>
            </div>
            {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
        </div>
    );
}

function Shell({ children }: { children: React.ReactNode }) {
    return (
        <div className="mx-auto max-w-3xl px-4 py-8">
            <h1 className="text-xl font-semibold tracking-tight">Your render provider</h1>
            <p className="mb-6 mt-2 text-sm text-muted-foreground">
                List a provider contract, set what a render costs, rotate the key that signs, and
                take out what you have earned.
            </p>
            {children}
        </div>
    );
}
