import Link from "next/link";
import { ChevronRight, ExternalLink } from "lucide-react";
import { shortAddress } from "@/lib/utils";
import { CopySeed } from "./CopySeed";
import { TimeAgo } from "@/components/TimeAgo";
import type { Piece } from "@/lib/piece";
import type { Listing } from "@/lib/market";
import type { ParamSpec, ParamValues } from "@/lib/params";
import { AccountLink } from "@/components/account/AccountLink";
import { CollektGalleryModal } from "@/components/gallery/CollektGalleryModal";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="flex items-baseline justify-between gap-4 py-2 text-sm">
            <span className="shrink-0 text-muted-foreground">{label}</span>
            <span className="min-w-0 truncate text-right font-medium">{children}</span>
        </div>
    );
}

function ParamValue({ spec, value }: { spec?: ParamSpec; value: unknown }) {
    const type = spec?.type;
    if (type === "bool") return <>{value ? "Yes" : "No"}</>;
    if (type === "color" && typeof value === "string") {
        return (
            <span className="inline-flex items-center gap-1.5">
                <span
                    className="h-3.5 w-3.5 shrink-0 rounded-sm border border-border/60"
                    style={{ backgroundColor: value }}
                    aria-hidden
                />
                <span className="font-mono text-xs">{value}</span>
            </span>
        );
    }
    if (type === "number" && typeof value === "number") {
        return <>{Number(value.toFixed(4))}</>;
    }
    return <>{String(value)}</>;
}

export function PieceFacts({
    piece,
    listing,
    paramsSchema,
    resolvedParams,
}: {
    piece: Piece;
    listing?: Listing | null;
    paramsSchema?: ParamSpec[];
    resolvedParams?: ParamValues;
}) {
    const holder = listing?.seller ?? piece.owner;
    const rawParams = !paramsSchema || paramsSchema.length === 0 ? safeParse(piece.params) : null;

    return (
        <div className="divide-y divide-border">
            <Row label="Generator">
                <Link
                    href={`/generator/${piece.contract}`}
                    className="inline-flex items-center gap-0.5 hover:underline"
                >
                    {piece.generatorName || "View generator"}
                    <ChevronRight size={12} aria-hidden className="shrink-0" />
                </Link>
            </Row>
            <Row label="3D Gallery">
                <CollektGalleryModal
                    generatorAddress={piece.contract}
                    generatorName={piece.name}
                    tokenId={piece.tokenId}
                    trigger={
                        <button
                            type="button"
                            className="inline-flex items-center gap-1 hover:underline text-muted-foreground hover:text-foreground"
                        >
                            <span>colleKT</span>
                            <ExternalLink size={12} aria-hidden className="shrink-0" />
                        </button>
                    }
                />
            </Row>
            <Row label="Edition">
                {Number(piece.tokenId) + 1}
                {piece.editionSize > 0 ? ` of ${piece.editionSize}` : " of an open edition"}
            </Row>
            {piece.artists.length > 0 && (
                <Row label={piece.artists.length > 1 ? "Artists" : "Artist"}>
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        {piece.artists.map((a) => (
                            <AccountLink key={a} address={a} />
                        ))}
                    </span>
                </Row>
            )}
            {holder && (
                <Row label={listing ? "Listed by" : "Owner"}>
                    <AccountLink address={holder} />
                </Row>
            )}
            {piece.mintedAt && (
                <Row label="Minted">
                    <TimeAgo iso={piece.mintedAt} />
                </Row>
            )}

            {piece.provider && (
                <Row label="Rendered by">
                    <Link href={`/providers/${piece.provider}`} className="hover:underline">
                        {piece.providerName || shortAddress(piece.provider)}
                    </Link>
                </Row>
            )}
            {piece.seed && (
                <Row label="Seed">
                    <CopySeed seed={piece.seed} />
                </Row>
            )}
            {piece.codeHash && (
                <Row label="Code hash">
                    <span className="font-mono text-xs" title={piece.codeHash}>
                        {shortAddress(piece.codeHash, 8, 6)}
                    </span>
                    {piece.code && !piece.codeVerified && (
                        <span className="ml-2 text-xs text-destructive">
                            does not match the source shown
                        </span>
                    )}
                </Row>
            )}

            {paramsSchema && paramsSchema.length > 0 && resolvedParams && (
                <div className="py-3">
                    <p className="pb-2 text-sm text-muted-foreground">Parameters</p>
                    <dl className="space-y-1">
                        {paramsSchema.map((spec) => (
                            <div key={spec.id} className="flex justify-between gap-4 text-sm">
                                <dt
                                    className="min-w-0 truncate text-muted-foreground"
                                    title={spec.label}
                                >
                                    {spec.label}
                                </dt>
                                <dd className="min-w-0 break-words text-right font-medium">
                                    <ParamValue spec={spec} value={resolvedParams[spec.id]} />
                                </dd>
                            </div>
                        ))}
                    </dl>
                </div>
            )}

            {rawParams && Object.keys(rawParams).length > 0 && (
                <div className="py-3">
                    <p className="pb-2 text-sm text-muted-foreground">Parameters</p>
                    <dl className="space-y-1">
                        {Object.entries(rawParams).map(([k, v]) => (
                            <div key={k} className="flex justify-between gap-4 text-sm">
                                <dt className="min-w-0 truncate text-muted-foreground" title={k}>
                                    {k}
                                </dt>
                                <dd className="min-w-0 break-words text-right font-medium">
                                    {String(v)}
                                </dd>
                            </div>
                        ))}
                    </dl>
                </div>
            )}

            {piece.royalties.length > 0 && (
                <div className="py-3">
                    <p className="pb-2 text-sm text-muted-foreground">Royalties</p>
                    <dl className="space-y-1">
                        {piece.royalties.map((r) => (
                            <div key={r.address} className="flex justify-between gap-4 text-sm">
                                <dt className="min-w-0 text-muted-foreground">
                                    <AccountLink address={r.address} />
                                </dt>
                                <dd className="shrink-0 font-medium">
                                    {(r.bps / 100).toFixed(2)}%
                                </dd>
                            </div>
                        ))}
                    </dl>
                </div>
            )}
        </div>
    );
}

function safeParse(json: string | undefined): Record<string, unknown> | null {
    if (!json) return null;
    try {
        const parsed = JSON.parse(json) as unknown;
        return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
    } catch {
        return null;
    }
}
