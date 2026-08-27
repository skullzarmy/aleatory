"use client";

import { useState } from "react";
import { Action } from "./Action";
import { setAgent, setRenderGas, withdrawRenderGas } from "@/lib/ops";
import { tez } from "@/lib/format";

const ADDRESS = /^(tz1|tz2|tz3|KT1)[1-9A-HJ-NP-Za-km-z]{33}$/;

/**
 * Validated here rather than at the confirm step, because that step states
 * what the operation will do and can only do so once the value is real.
 */
export function Amount(
    props:
        | { kind: "withdraw"; provider: string; max: number; operator: string; defaultTo: string }
        | { kind: "render-gas"; provider: string; current: number; operator: string }
        | { kind: "agent"; provider: string; current: string; operator: string },
) {
    const [value, setValue] = useState("");
    const [to, setTo] = useState(props.kind === "withdraw" ? props.defaultTo : "");

    if (props.kind === "withdraw") {
        const mutez = Math.round(Number(value) * 1_000_000);
        const valid =
            Number.isFinite(mutez) && mutez > 0 && mutez <= props.max && ADDRESS.test(to);

        return (
            <div className="space-y-2">
                <p className="label">Withdraw render gas</p>
                <div className="flex flex-wrap gap-2">
                    <label className="flex items-center gap-2 text-sm">
                        <span className="text-dim">Amount</span>
                        <input
                            className="w-32 rounded border border-line bg-base px-2 py-1 font-mono text-sm"
                            inputMode="decimal"
                            placeholder="0.00"
                            value={value}
                            onChange={(e) => setValue(e.target.value)}
                        />
                        <span className="text-dim">ꜩ</span>
                    </label>
                    <button
                        type="button"
                        className="btn"
                        onClick={() => setValue(String(props.max / 1_000_000))}
                    >
                        All ({tez(props.max)})
                    </button>
                </div>
                <label className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="text-dim">To</span>
                    <input
                        className="w-80 max-w-full rounded border border-line bg-base px-2 py-1 font-mono text-sm"
                        placeholder="tz1…"
                        value={to}
                        onChange={(e) => setTo(e.target.value)}
                    />
                </label>
                {valid ? (
                    <Action op={withdrawRenderGas(props.provider, mutez, to)} holder={props.operator} />
                ) : (
                    <p className="text-xs text-dim">
                        {props.max === 0
                            ? "Nothing to withdraw."
                            : "Enter an amount within the balance and a valid destination."}
                    </p>
                )}
            </div>
        );
    }

    if (props.kind === "render-gas") {
        const mutez = Math.round(Number(value) * 1_000_000);
        const valid = Number.isFinite(mutez) && mutez >= 0 && value !== "";
        return (
            <div className="space-y-2">
                <p className="label">Render gas per mint</p>
                <p className="text-xs text-dim">
                    Currently {tez(props.current)}. Collections snapshot this when the artist
                    picks the provider, so a change reaches new collections only.
                </p>
                <label className="flex items-center gap-2 text-sm">
                    <input
                        className="w-32 rounded border border-line bg-base px-2 py-1 font-mono text-sm"
                        inputMode="decimal"
                        placeholder={String(props.current / 1_000_000)}
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                    />
                    <span className="text-dim">ꜩ</span>
                </label>
                {valid && mutez !== props.current && (
                    <Action op={setRenderGas(props.provider, mutez)} holder={props.operator} />
                )}
            </div>
        );
    }

    const valid = ADDRESS.test(value) && value !== props.current;
    return (
        <div className="space-y-2">
            <p className="label">Rotate the agent key</p>
            <p className="text-xs text-dim">
                One operation revokes the current key everywhere. Collections ask this
                contract for the live agent rather than trusting what they snapshotted, so
                every collection using this provider follows immediately and no artist has to
                act. This is the control to reach for if the daemon key leaks.
            </p>
            <label className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-dim">New agent</span>
                <input
                    className="w-80 max-w-full rounded border border-line bg-base px-2 py-1 font-mono text-sm"
                    placeholder="tz1…"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                />
            </label>
            {valid && <Action op={setAgent(props.provider, value)} holder={props.operator} />}
        </div>
    );
}
