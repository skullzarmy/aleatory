import { tzktLink } from "@/lib/config";
import { shortAddress } from "@/lib/format";

export function Addr({ address, full = false }: { address: string; full?: boolean }) {
    if (!address) return <span className="text-dim">not set</span>;
    return (
        <a
            href={tzktLink(address)}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-sm underline decoration-dotted hover:decoration-solid"
        >
            {full ? address : shortAddress(address)}
        </a>
    );
}

export function Card({
    title,
    subtitle,
    children,
}: {
    title: string;
    subtitle?: string;
    children: React.ReactNode;
}) {
    return (
        <section className="card space-y-4">
            <div>
                <h2 className="font-semibold tracking-tight">{title}</h2>
                {subtitle && <p className="mt-0.5 text-xs text-dim">{subtitle}</p>}
            </div>
            {children}
        </section>
    );
}

export function Row({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line/40 py-1.5 last:border-0">
            <span className="text-sm text-dim">{label}</span>
            <span className="text-sm">{children}</span>
        </div>
    );
}

/** A number that is the point of the card, not a detail in it. */
export function Stat({
    label,
    value,
    tone = "plain",
    note,
}: {
    label: string;
    value: string;
    tone?: "plain" | "ok" | "warn" | "bad";
    note?: string;
}) {
    const colour =
        tone === "ok"
            ? "text-ok"
            : tone === "warn"
              ? "text-warn"
              : tone === "bad"
                ? "text-bad"
                : "text-fg";
    return (
        <div className="card">
            <p className="label">{label}</p>
            <p className={`num mt-1 ${colour}`}>{value}</p>
            {note && <p className="mt-1 text-xs text-dim">{note}</p>}
        </div>
    );
}
