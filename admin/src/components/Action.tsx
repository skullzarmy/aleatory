"use client";

import { useState } from "react";
import { useWallet } from "@/context/WalletContext";
import { signNow, toProposal, type AdminOp } from "@/lib/ops";
import { tzktLink } from "@/lib/config";
import { shortAddress } from "@/lib/format";

/**
 * Both sinks from `ops.ts` behind one control: it signs when you hold the key
 * the chain will accept, and exports a proposal when you do not, which is the
 * normal path once a multisig that cannot hold a wallet session administers
 * these contracts.
 */
export function Action({
    op,
    /** The address the chain requires, from storage. Ignored if permissionless. */
    holder,
    /** Why this cannot be done right now, if it cannot. */
    unavailable,
    onDone,
}: {
    op: AdminOp;
    holder?: string;
    unavailable?: string;
    onDone?: () => void;
}) {
    const { address, connect, getClient } = useWallet();
    const [confirming, setConfirming] = useState(false);
    const [busy, setBusy] = useState(false);
    const [hash, setHash] = useState<string | null>(null);
    const [proposal, setProposal] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const permissionless = op.authority === "anyone";
    const maySign = permissionless || (!!address && !!holder && address === holder);

    async function send() {
        setBusy(true);
        setError(null);
        try {
            const client = await getClient();
            const { hash } = await signNow(client, op);
            setHash(hash);
            setConfirming(false);
            onDone?.();
        } catch (e) {
            setError(e instanceof Error ? e.message : "The operation failed");
        } finally {
            setBusy(false);
        }
    }

    async function exportProposal() {
        setBusy(true);
        setError(null);
        try {
            setProposal(await toProposal(op));
            setConfirming(false);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Could not encode the operation");
        } finally {
            setBusy(false);
        }
    }

    if (hash) {
        return (
            <p className="text-sm text-ok">
                Sent.{" "}
                <a
                    href={tzktLink(hash)}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono underline"
                >
                    {shortAddress(hash)}
                </a>
            </p>
        );
    }

    if (proposal) {
        return (
            <div className="space-y-2">
                <p className="text-xs text-dim">
                    Hand this to the multisig. It is the call, not a signature.
                </p>
                <pre className="max-h-64 overflow-auto rounded border border-line bg-sunk p-3 text-xs">
                    {proposal}
                </pre>
                <div className="flex gap-2">
                    <button
                        type="button"
                        className="btn"
                        onClick={() => void navigator.clipboard.writeText(proposal)}
                    >
                        Copy
                    </button>
                    <button type="button" className="btn" onClick={() => setProposal(null)}>
                        Done
                    </button>
                </div>
            </div>
        );
    }

    if (unavailable) {
        return <p className="text-sm text-dim">{unavailable}</p>;
    }

    if (confirming) {
        return (
            <div className="space-y-2 rounded border border-warn/40 bg-warn/5 p-3">
                <p className="text-sm">{op.label}.</p>
                <div className="flex flex-wrap gap-2">
                    <button
                        type="button"
                        className="btn btn-go"
                        disabled={busy}
                        onClick={() => void (maySign ? send() : exportProposal())}
                    >
                        {busy
                            ? "Working…"
                            : maySign
                              ? "Sign and send"
                              : "Export the proposal"}
                    </button>
                    <button
                        type="button"
                        className="btn"
                        disabled={busy}
                        onClick={() => setConfirming(false)}
                    >
                        Cancel
                    </button>
                </div>
                {error && <p className="text-sm text-bad">{error}</p>}
            </div>
        );
    }

    return (
        <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
                <button type="button" className="btn" onClick={() => setConfirming(true)}>
                    {op.label}
                </button>
                {!permissionless && (
                    <span className="text-xs text-dim">
                        {op.authority === "admin" ? "admin" : "operator"} key
                    </span>
                )}
            </div>

            {/* Say up front which key the chain will accept, rather than
                letting a signature go out and come back rejected. */}
            {!maySign && !address && (
                <p className="text-xs text-dim">
                    <button type="button" className="underline" onClick={() => void connect()}>
                        Connect
                    </button>{" "}
                    to sign, or continue to export it as a proposal.
                </p>
            )}
            {!maySign && address && holder && (
                <p className="text-xs text-warn">
                    Signed by{" "}
                    <a
                        href={tzktLink(holder)}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono underline"
                    >
                        {shortAddress(holder)}
                    </a>
                    , which is not the account you are holding. Export it instead.
                </p>
            )}
            {error && <p className="text-sm text-bad">{error}</p>}
        </div>
    );
}
