"use client";

import { Plus, X } from "lucide-react";
import {
    formatParamValue,
    MAX_PARAMS,
    newParam,
    type ParamSpec,
    type ParamType,
    type ParamValue,
    type ParamValues,
    resolveParam,
    resolveParams,
    validateSchema,
} from "@/lib/params";

/**
 * Aleatory, the params panel.
 *
 * Two components, and the split between them is the whole point:
 *
 *   <ParamsDeclaration>  the artist declares up to five named inputs
 *   <ParamsTuner>        anyone turns them
 *
 * The tuner is built from nothing but the declaration. It reads no template, no
 * kind, no code: feed it a schema fetched from contract storage and it renders
 * the right controls. That is deliberate, it is the reference implementation of
 * the mint UI another platform has to be able to build for our generators
 * without our source (docs/aleatory/params.md), and keeping it honest is easier
 * when our own mint form is that same component.
 *
 * <ParamsPanel> is the studio's view of the pair: declare on the left, turn the
 * result on the right, so an artist sees the control a collector will get at
 * the moment they declare it.
 */

const field =
    "w-full rounded border border-border bg-background px-2 py-1 font-mono text-xs outline-none focus:border-alea-600";
const tinyLabel = "mb-1 block text-[10px] uppercase tracking-wide text-muted-foreground";

const TYPES: { id: ParamType; label: string }[] = [
    { id: "number", label: "number" },
    { id: "int", label: "whole number" },
    { id: "bool", label: "on / off" },
    { id: "color", label: "colour" },
    { id: "select", label: "choice" },
];

// ---------------------------------------------------------------------------
// The studio's pair
// ---------------------------------------------------------------------------

export function ParamsPanel({
    specs,
    values,
    onSpecsChange,
    onValuesChange,
}: {
    specs: ParamSpec[];
    values: ParamValues;
    onSpecsChange: (specs: ParamSpec[]) => void;
    onValuesChange: (values: ParamValues) => void;
}) {
    return (
        <div className="grid gap-8 lg:grid-cols-[1fr_18rem]">
            <div>
                <h2 className="text-sm font-medium">What a collector may change</h2>
                <p className="mb-4 mt-1 text-xs text-muted-foreground">
                    Up to {MAX_PARAMS}. Names can&apos;t be changed after you publish.
                </p>
                <ParamsDeclaration specs={specs} onChange={onSpecsChange} />
            </div>

            <div className="lg:border-l lg:border-border lg:pl-6">
                <h2 className="text-sm font-medium">Preview</h2>
                <p className="mb-4 mt-1 text-xs text-muted-foreground">
                    {specs.length === 0
                        ? "Add a parameter and its control shows up here."
                        : "What a collector sees when they mint."}
                </p>
                <ParamsTuner specs={specs} values={values} onChange={onValuesChange} />
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Declaring, the artist's side
// ---------------------------------------------------------------------------

export function ParamsDeclaration({
    specs,
    onChange,
}: {
    specs: ParamSpec[];
    onChange: (specs: ParamSpec[]) => void;
}) {
    const errors = validateSchema(specs);

    const update = (index: number, patch: Partial<ParamSpec>) => {
        const next = specs.map((spec, i) => (i === index ? { ...spec, ...patch } : spec));
        // A type change carries its own sensible shape with it, or the row is
        // left holding a min/max that means nothing and a default that is now
        // the wrong kind of thing entirely.
        if (patch.type) {
            const spec = next[index];
            if (patch.type === "number")
                Object.assign(spec, {
                    min: 0,
                    max: 1,
                    step: 0.01,
                    default: 0.5,
                    options: undefined,
                });
            if (patch.type === "int")
                Object.assign(spec, { min: 0, max: 100, step: 1, default: 50, options: undefined });
            if (patch.type === "bool")
                Object.assign(spec, {
                    min: undefined,
                    max: undefined,
                    step: undefined,
                    default: false,
                    options: undefined,
                });
            if (patch.type === "color")
                Object.assign(spec, {
                    min: undefined,
                    max: undefined,
                    step: undefined,
                    default: "#888888",
                    options: undefined,
                });
            if (patch.type === "select")
                Object.assign(spec, {
                    min: undefined,
                    max: undefined,
                    step: undefined,
                    options: ["one", "two"],
                    default: "one",
                });
        }
        onChange(next);
    };

    return (
        <div className="space-y-3">
            {specs.length === 0 && (
                <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-xs text-muted-foreground">
                    No parameters yet. Plenty of pieces don&apos;t need any.
                </p>
            )}

            {specs.map((spec, index) => (
                <div
                    key={`${index}-${spec.id}`}
                    className="space-y-3 rounded-lg border border-border p-3"
                >
                    <div className="flex flex-wrap items-end gap-2">
                        <label className="min-w-0 flex-[1_1_130px]">
                            <span className={tinyLabel}>Name in code</span>
                            <input
                                value={spec.id}
                                onChange={(e) => update(index, { id: e.target.value.trim() })}
                                spellCheck={false}
                                className={field}
                            />
                        </label>
                        <label className="min-w-0 flex-[1_1_130px]">
                            <span className={tinyLabel}>Label</span>
                            <input
                                value={spec.label}
                                onChange={(e) => update(index, { label: e.target.value })}
                                className={field}
                            />
                        </label>
                        <label className="min-w-0 flex-[0_1_130px]">
                            <span className={tinyLabel}>Type</span>
                            <select
                                value={spec.type}
                                onChange={(e) =>
                                    update(index, { type: e.target.value as ParamType })
                                }
                                className={field}
                            >
                                {TYPES.map((t) => (
                                    <option key={t.id} value={t.id}>
                                        {t.label}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <button
                            type="button"
                            aria-label={`Remove ${spec.label || spec.id}`}
                            onClick={() => onChange(specs.filter((_, i) => i !== index))}
                            className="rounded border border-border p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                        >
                            <X size={12} aria-hidden />
                        </button>
                    </div>

                    <div className="flex flex-wrap items-end gap-2">
                        {(spec.type === "number" || spec.type === "int") && (
                            <>
                                <label className="min-w-0 flex-[1_1_80px]">
                                    <span className={tinyLabel}>Min</span>
                                    <input
                                        type="number"
                                        value={spec.min ?? 0}
                                        onChange={(e) =>
                                            update(index, { min: Number(e.target.value) })
                                        }
                                        className={field}
                                    />
                                </label>
                                <label className="min-w-0 flex-[1_1_80px]">
                                    <span className={tinyLabel}>Max</span>
                                    <input
                                        type="number"
                                        value={spec.max ?? 1}
                                        onChange={(e) =>
                                            update(index, { max: Number(e.target.value) })
                                        }
                                        className={field}
                                    />
                                </label>
                                <label className="min-w-0 flex-[1_1_80px]">
                                    <span className={tinyLabel}>Step</span>
                                    <input
                                        type="number"
                                        value={spec.step ?? (spec.type === "int" ? 1 : 0.01)}
                                        onChange={(e) =>
                                            update(index, { step: Number(e.target.value) })
                                        }
                                        className={field}
                                    />
                                </label>
                            </>
                        )}

                        {spec.type === "select" && (
                            <label className="min-w-0 flex-[1_1_220px]">
                                <span className={tinyLabel}>Options, comma separated</span>
                                <input
                                    value={(spec.options ?? []).join(", ")}
                                    onChange={(e) => {
                                        const options = e.target.value
                                            .split(",")
                                            .map((o) => o.trim())
                                            .filter(Boolean);
                                        const stillValid =
                                            typeof spec.default === "string" &&
                                            options.includes(spec.default);
                                        update(index, {
                                            options,
                                            default: stillValid ? spec.default : (options[0] ?? ""),
                                        });
                                    }}
                                    className={field}
                                />
                            </label>
                        )}

                        <label className="min-w-0 flex-[1_1_110px]">
                            <span className={tinyLabel}>Default</span>
                            <DefaultInput
                                spec={spec}
                                onChange={(value) => update(index, { default: value })}
                            />
                        </label>

                        <label className="min-w-0 flex-[2_1_180px]">
                            <span className={tinyLabel}>Hint, optional</span>
                            <input
                                value={spec.hint ?? ""}
                                onChange={(e) =>
                                    update(index, { hint: e.target.value || undefined })
                                }
                                placeholder="One line, shown under the control"
                                className={field}
                            />
                        </label>
                    </div>

                    <code className="block truncate font-mono text-[11px] text-muted-foreground">
                        {`$alea.param("${spec.id}", ${JSON.stringify(spec.default)})`}
                    </code>
                </div>
            ))}

            <div className="flex flex-wrap items-center gap-3">
                <button
                    type="button"
                    disabled={specs.length >= MAX_PARAMS}
                    onClick={() => onChange([...specs, newParam(specs)])}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
                >
                    <Plus size={13} aria-hidden /> Add parameter
                </button>
                <span className="text-xs text-muted-foreground">
                    {specs.length} of {MAX_PARAMS}
                </span>
            </div>

            {errors.length > 0 && (
                <ul className="space-y-1 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2">
                    {errors.map((e) => (
                        <li key={e} className="text-xs leading-relaxed">
                            {e}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

function DefaultInput({
    spec,
    onChange,
}: {
    spec: ParamSpec;
    onChange: (value: ParamValue) => void;
}) {
    if (spec.type === "bool") {
        return (
            <select
                value={String(spec.default === true)}
                onChange={(e) => onChange(e.target.value === "true")}
                className={field}
            >
                <option value="false">off</option>
                <option value="true">on</option>
            </select>
        );
    }
    if (spec.type === "select") {
        return (
            <select
                value={String(spec.default)}
                onChange={(e) => onChange(e.target.value)}
                className={field}
            >
                {(spec.options ?? []).map((o) => (
                    <option key={o} value={o}>
                        {o}
                    </option>
                ))}
            </select>
        );
    }
    if (spec.type === "color") {
        return (
            <input
                type="color"
                value={String(spec.default)}
                onChange={(e) => onChange(e.target.value)}
                className="h-[1.9rem] w-full rounded border border-border bg-background p-0"
            />
        );
    }
    return (
        <input
            type="number"
            value={Number(spec.default)}
            onChange={(e) => onChange(Number(e.target.value))}
            className={field}
        />
    );
}

// ---------------------------------------------------------------------------
// Tuning, everyone else's side
// ---------------------------------------------------------------------------

/**
 * Controls generated from a declaration alone.
 *
 * Every value that leaves here has been through `resolveParam`, so what the
 * control emits is exactly what the piece will receive and exactly what gets
 * written to the token. A tuner that let a value through unresolved would be a
 * preview that lies about the thing being minted.
 */
export function ParamsTuner({
    specs,
    values,
    onChange,
    disabled = false,
}: {
    specs: ParamSpec[];
    values: ParamValues;
    onChange: (values: ParamValues) => void;
    /** Read-only rendering, for showing what a minted piece was set to. */
    disabled?: boolean;
}) {
    if (specs.length === 0) return null;
    const resolved = resolveParams(specs, values);
    const set = (spec: ParamSpec, raw: unknown) => {
        if (disabled) return;
        onChange({ ...resolved, [spec.id]: resolveParam(spec, raw) });
    };

    return (
        <div className="space-y-4">
            {specs.map((spec) => {
                const value = resolved[spec.id];
                return (
                    <div key={spec.id}>
                        <div className="flex items-baseline justify-between gap-2">
                            <span className="min-w-0 truncate text-sm">{spec.label}</span>
                            <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
                                {formatParamValue(spec, value)}
                            </span>
                        </div>

                        {(spec.type === "number" || spec.type === "int") && (
                            <input
                                type="range"
                                min={spec.min ?? 0}
                                max={spec.max ?? 1}
                                step={spec.step ?? (spec.type === "int" ? 1 : 0.01)}
                                value={Number(value)}
                                disabled={disabled}
                                onChange={(e) => set(spec, Number(e.target.value))}
                                className="mt-1 w-full accent-alea-600"
                            />
                        )}
                        {spec.type === "bool" && (
                            <select
                                value={String(value === true)}
                                disabled={disabled}
                                onChange={(e) => set(spec, e.target.value)}
                                className={`mt-1 ${field}`}
                            >
                                <option value="false">off</option>
                                <option value="true">on</option>
                            </select>
                        )}
                        {spec.type === "select" && (
                            <select
                                value={String(value)}
                                disabled={disabled}
                                onChange={(e) => set(spec, e.target.value)}
                                className={`mt-1 ${field}`}
                            >
                                {(spec.options ?? []).map((o) => (
                                    <option key={o} value={o}>
                                        {o}
                                    </option>
                                ))}
                            </select>
                        )}
                        {spec.type === "color" && (
                            <input
                                type="color"
                                value={String(value)}
                                disabled={disabled}
                                onChange={(e) => set(spec, e.target.value)}
                                className="mt-1 h-8 w-full rounded border border-border bg-background p-0"
                            />
                        )}

                        {spec.hint && (
                            <p className="mt-1 text-xs text-muted-foreground">{spec.hint}</p>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
