/** biome-ignore-all lint/suspicious/noCommentText: `// …` is the house voice in lab copy */
/**
 * Aleatory — the params panel.
 *
 * Two components, and the split between them is the whole point:
 *
 *   <ParamsDeclaration>  the artist declares up to five named inputs
 *   <ParamsTuner>        anyone turns them
 *
 * The tuner is built from nothing but the declaration. It reads no template, no
 * kind, no code — feed it a schema fetched from contract storage and it renders
 * the right controls. That is deliberate: it is the reference implementation of
 * the mint UI another platform has to be able to build for our generators
 * without our source (docs/aleatory/params.md), and keeping it honest is easier
 * when the lab's own mint form is that same component.
 */
import { Plus, X } from "lucide-react";
import type { CSSProperties } from "react";
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
} from "../../lib/aleatory/params";

const mono = "var(--font-mono)";

const field: CSSProperties = {
    fontFamily: mono,
    fontSize: "0.76rem",
    padding: "0.3rem 0.4rem",
    background: "var(--bg)",
    border: "1px solid var(--border)",
    color: "var(--fg)",
    boxSizing: "border-box",
    width: "100%",
    minWidth: 0,
};

const tinyLabel: CSSProperties = {
    fontFamily: mono,
    fontSize: "0.6rem",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    color: "var(--fg-muted)",
    display: "block",
    marginBottom: "0.2rem",
};

const iconButton: CSSProperties = {
    fontFamily: mono,
    fontSize: "0.72rem",
    padding: "0.3rem 0.5rem",
    border: "1px solid var(--border)",
    background: "var(--bg-card)",
    color: "var(--fg)",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: "0.35rem",
};

const TYPES: Array<{ id: ParamType; label: string }> = [
    { id: "number", label: "number" },
    { id: "int", label: "whole number" },
    { id: "bool", label: "on / off" },
    { id: "color", label: "colour" },
    { id: "select", label: "choice" },
];

// ---------------------------------------------------------------------------
// Declaration — the artist's side
// ---------------------------------------------------------------------------

interface DeclarationProps {
    specs: ParamSpec[];
    onChange: (specs: ParamSpec[]) => void;
}

export function ParamsDeclaration({ specs, onChange }: DeclarationProps) {
    const errors = validateSchema(specs);

    const update = (index: number, patch: Partial<ParamSpec>) => {
        const next = specs.map((spec, i) => (i === index ? { ...spec, ...patch } : spec));
        // A type change carries its own sensible shape with it, or the row is
        // left holding a min/max that means nothing and a default that is now
        // the wrong kind of thing entirely.
        if (patch.type) {
            const spec = next[index];
            if (patch.type === "number") Object.assign(spec, { min: 0, max: 1, step: 0.01, default: 0.5, options: undefined });
            if (patch.type === "int") Object.assign(spec, { min: 0, max: 100, step: 1, default: 50, options: undefined });
            if (patch.type === "bool") Object.assign(spec, { min: undefined, max: undefined, step: undefined, default: false, options: undefined });
            if (patch.type === "color") Object.assign(spec, { min: undefined, max: undefined, step: undefined, default: "#888888", options: undefined });
            if (patch.type === "select") Object.assign(spec, { min: undefined, max: undefined, step: undefined, options: ["one", "two"], default: "one" });
        }
        onChange(next);
    };

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.7rem" }}>
            {specs.length === 0 && (
                <p style={{ fontFamily: mono, fontSize: "0.72rem", color: "var(--fg-muted)", margin: 0, lineHeight: 1.7 }}>
                    // no parameters. that is the normal case — a piece can be the seed alone. declare one and it becomes a control
                    the minter turns, stored on chain with their token.
                </p>
            )}

            {specs.map((spec, index) => (
                <div
                    key={`${index}-${spec.id}`}
                    style={{
                        border: "1px solid var(--border)",
                        padding: "0.6rem",
                        display: "flex",
                        flexDirection: "column",
                        gap: "0.5rem",
                    }}
                >
                    <div style={{ display: "flex", gap: "0.4rem", alignItems: "flex-end", flexWrap: "wrap" }}>
                        <label style={{ flex: "1 1 130px", minWidth: 0 }}>
                            <span style={tinyLabel}>name in code</span>
                            <input
                                value={spec.id}
                                onChange={(e) => update(index, { id: e.target.value.trim() })}
                                spellCheck={false}
                                style={field}
                            />
                        </label>
                        <label style={{ flex: "1 1 130px", minWidth: 0 }}>
                            <span style={tinyLabel}>label</span>
                            <input value={spec.label} onChange={(e) => update(index, { label: e.target.value })} style={field} />
                        </label>
                        <label style={{ flex: "0 1 130px", minWidth: 0 }}>
                            <span style={tinyLabel}>type</span>
                            <select value={spec.type} onChange={(e) => update(index, { type: e.target.value as ParamType })} style={field}>
                                {TYPES.map((t) => (
                                    <option key={t.id} value={t.id}>
                                        {t.label}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <button
                            type="button"
                            aria-label={`remove ${spec.label || spec.id}`}
                            style={iconButton}
                            onClick={() => onChange(specs.filter((_, i) => i !== index))}
                        >
                            <X size={12} aria-hidden="true" />
                        </button>
                    </div>

                    <div style={{ display: "flex", gap: "0.4rem", alignItems: "flex-end", flexWrap: "wrap" }}>
                        {(spec.type === "number" || spec.type === "int") && (
                            <>
                                <label style={{ flex: "1 1 80px", minWidth: 0 }}>
                                    <span style={tinyLabel}>min</span>
                                    <input
                                        type="number"
                                        value={spec.min ?? 0}
                                        onChange={(e) => update(index, { min: Number(e.target.value) })}
                                        style={field}
                                    />
                                </label>
                                <label style={{ flex: "1 1 80px", minWidth: 0 }}>
                                    <span style={tinyLabel}>max</span>
                                    <input
                                        type="number"
                                        value={spec.max ?? 1}
                                        onChange={(e) => update(index, { max: Number(e.target.value) })}
                                        style={field}
                                    />
                                </label>
                                <label style={{ flex: "1 1 80px", minWidth: 0 }}>
                                    <span style={tinyLabel}>step</span>
                                    <input
                                        type="number"
                                        value={spec.step ?? (spec.type === "int" ? 1 : 0.01)}
                                        onChange={(e) => update(index, { step: Number(e.target.value) })}
                                        style={field}
                                    />
                                </label>
                            </>
                        )}
                        {spec.type === "select" && (
                            <label style={{ flex: "1 1 220px", minWidth: 0 }}>
                                <span style={tinyLabel}>options, comma separated</span>
                                <input
                                    value={(spec.options ?? []).join(", ")}
                                    onChange={(e) => {
                                        const options = e.target.value.split(",").map((o) => o.trim()).filter(Boolean);
                                        const stillValid = typeof spec.default === "string" && options.includes(spec.default);
                                        update(index, { options, default: stillValid ? spec.default : (options[0] ?? "") });
                                    }}
                                    style={field}
                                />
                            </label>
                        )}
                        <label style={{ flex: "1 1 110px", minWidth: 0 }}>
                            <span style={tinyLabel}>default</span>
                            <DefaultInput spec={spec} onChange={(value) => update(index, { default: value })} />
                        </label>
                        <label style={{ flex: "2 1 180px", minWidth: 0 }}>
                            <span style={tinyLabel}>hint (optional)</span>
                            <input
                                value={spec.hint ?? ""}
                                onChange={(e) => update(index, { hint: e.target.value || undefined })}
                                placeholder="one line, shown under the control"
                                style={field}
                            />
                        </label>
                    </div>

                    <code style={{ fontFamily: mono, fontSize: "0.68rem", color: "var(--fg-muted)" }}>
                        {`$alea.param("${spec.id}", ${JSON.stringify(spec.default)})`}
                    </code>
                </div>
            ))}

            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                <button
                    type="button"
                    style={{ ...iconButton, opacity: specs.length >= MAX_PARAMS ? 0.5 : 1 }}
                    disabled={specs.length >= MAX_PARAMS}
                    onClick={() => onChange([...specs, newParam(specs)])}
                >
                    <Plus size={12} aria-hidden="true" /> add parameter
                </button>
                <span style={{ fontFamily: mono, fontSize: "0.68rem", color: "var(--fg-muted)" }}>
                    // {specs.length} of {MAX_PARAMS}
                </span>
            </div>

            {errors.map((e) => (
                <p key={e} style={{ fontFamily: mono, fontSize: "0.72rem", color: "var(--err, #ff6b6b)", margin: 0, lineHeight: 1.6 }}>
                    // {e}
                </p>
            ))}
        </div>
    );
}

function DefaultInput({ spec, onChange }: { spec: ParamSpec; onChange: (value: ParamValue) => void }) {
    if (spec.type === "bool") {
        return (
            <select value={String(spec.default === true)} onChange={(e) => onChange(e.target.value === "true")} style={field}>
                <option value="false">off</option>
                <option value="true">on</option>
            </select>
        );
    }
    if (spec.type === "select") {
        return (
            <select value={String(spec.default)} onChange={(e) => onChange(e.target.value)} style={field}>
                {(spec.options ?? []).map((o) => (
                    <option key={o} value={o}>
                        {o}
                    </option>
                ))}
            </select>
        );
    }
    if (spec.type === "color") {
        return <input type="color" value={String(spec.default)} onChange={(e) => onChange(e.target.value)} style={{ ...field, padding: 0, height: "1.9rem" }} />;
    }
    return <input type="number" value={Number(spec.default)} onChange={(e) => onChange(Number(e.target.value))} style={field} />;
}

// ---------------------------------------------------------------------------
// Tuner — everyone else's side
// ---------------------------------------------------------------------------

interface TunerProps {
    specs: ParamSpec[];
    values: ParamValues;
    onChange: (values: ParamValues) => void;
    /** Read-only rendering, for showing what a minted piece was set to. */
    disabled?: boolean;
}

/**
 * Controls generated from a declaration alone.
 *
 * Every value that leaves here has been through `resolveParam`, so what the
 * control emits is exactly what the piece will receive and exactly what gets
 * written to the token. A tuner that let a value through unresolved would be a
 * preview that lies about the thing being minted.
 */
export function ParamsTuner({ specs, values, onChange, disabled = false }: TunerProps) {
    if (specs.length === 0) return null;
    const resolved = resolveParams(specs, values);
    const set = (spec: ParamSpec, raw: unknown) => {
        if (disabled) return;
        onChange({ ...resolved, [spec.id]: resolveParam(spec, raw) });
    };

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.65rem" }}>
            {specs.map((spec) => {
                const value = resolved[spec.id];
                return (
                    <div key={spec.id}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem", alignItems: "baseline" }}>
                            <span style={{ fontFamily: mono, fontSize: "0.72rem", color: "var(--fg)" }}>{spec.label}</span>
                            <span style={{ fontFamily: mono, fontSize: "0.7rem", color: "var(--fg-muted)" }}>
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
                                style={{ width: "100%", accentColor: "var(--fg)" }}
                            />
                        )}
                        {spec.type === "bool" && (
                            <select value={String(value === true)} disabled={disabled} onChange={(e) => set(spec, e.target.value)} style={field}>
                                <option value="false">off</option>
                                <option value="true">on</option>
                            </select>
                        )}
                        {spec.type === "select" && (
                            <select value={String(value)} disabled={disabled} onChange={(e) => set(spec, e.target.value)} style={field}>
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
                                style={{ ...field, padding: 0, height: "2rem" }}
                            />
                        )}

                        {spec.hint && (
                            <p style={{ fontFamily: mono, fontSize: "0.66rem", color: "var(--fg-muted)", margin: "0.2rem 0 0" }}>
                                {spec.hint}
                            </p>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
