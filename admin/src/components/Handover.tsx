"use client";

import { useState } from "react";
import { Action } from "./Action";
import { Addr } from "./Bits";
import { acceptAdmin, proposeAdmin } from "@/lib/ops";

const ADDRESS = /^(tz1|tz2|tz3|KT1)[1-9A-HJ-NP-Za-km-z]{33}$/;

export interface Administered {
    name: string;
    address: string;
    administrator: string;
    proposedAdmin: string | null;
}

/**
 * Moving administration, one contract at a time.
 *
 * Two steps everywhere: the current administrator proposes, and the proposed
 * address accepts. Nothing changes hands until that second call, so a typo
 * cannot strand a contract with an administrator that does not exist.
 *
 * Each contract is separate. There is no operation that moves all of them at
 * once, and a handover half done leaves the platform administered by two
 * different parties, so the pending column is the one to read.
 */
export function Handover({ contracts }: { contracts: Administered[] }) {
    return (
        <div className="space-y-6">
            {contracts.map((c) => (
                <One key={c.address} contract={c} />
            ))}
        </div>
    );
}

function One({ contract }: { contract: Administered }) {
    const [raw, setRaw] = useState("");
    const candidate = raw.trim();
    const valid = ADDRESS.test(candidate) && candidate !== contract.administrator;

    return (
        <div className="border-b border-line/40 pb-5 last:border-0 last:pb-0">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-sm font-medium">{contract.name}</span>
                <Addr address={contract.address} />
            </div>

            <p className="mt-1 text-xs text-dim">
                Administered by <Addr address={contract.administrator} />
            </p>

            {contract.proposedAdmin ? (
                <div className="mt-3 space-y-2 rounded border border-warn/40 bg-warn/5 p-3">
                    <p className="text-sm">
                        Offered to <Addr address={contract.proposedAdmin} />, not yet accepted.
                        Administration has not moved.
                    </p>
                    <Action
                        op={acceptAdmin(contract.address)}
                        holder={contract.proposedAdmin}
                    />
                </div>
            ) : (
                <div className="mt-3 space-y-2">
                    <label className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="text-dim">Offer to</span>
                        <input
                            className={`w-80 max-w-full rounded border bg-base px-2 py-1 font-mono text-sm ${
                                raw !== "" && !valid ? "border-bad" : "border-line"
                            }`}
                            placeholder="tz1… or KT1… of the multisig"
                            value={raw}
                            onChange={(e) => setRaw(e.target.value)}
                        />
                    </label>
                    {valid && (
                        <Action
                            op={proposeAdmin(contract.address, candidate)}
                            holder={contract.administrator}
                        />
                    )}
                </div>
            )}
        </div>
    );
}
