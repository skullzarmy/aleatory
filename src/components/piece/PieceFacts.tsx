import Link from "next/link";
import { tzktLink } from "@/lib/config";
import { shortAddress } from "@/lib/utils";
import { TimeAgo } from "@/components/TimeAgo";
import type { Piece } from "@/lib/piece";
import { AccountLink } from "@/components/account/AccountLink";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="flex items-baseline justify-between gap-4 py-2 text-sm">
            <span className="shrink-0 text-muted-foreground">{label}</span>
            <span className="min-w-0 truncate text-right font-medium">{children}</span>
        </div>
    );
}

/**
 * What determines the piece, stated so a reader can check it.
 *
 * Seed, parameters and code hash are the three inputs. Anyone holding them
 * can reproduce the output and compare it to what the collection displays.
 */
export function PieceFacts({ piece }: { piece: Piece }) {
    const params = piece.params ? safeParse(piece.params) : null;

    return (
        <div className="divide-y divide-border">
            <Row label="Collection">
                <Link href={`/collection/${piece.contract}`} className="hover:underline">
                    {piece.collectionName || shortAddress(piece.contract)}
                </Link>
            </Row>
            <Row label="Edition">
                {Number(piece.tokenId) + 1}
                {piece.editionSize > 0 ? ` of ${piece.editionSize}` : " of an open edition"}
            </Row>
            <Row label="Artist">
                <AccountLink address={piece.artist} />
            </Row>
            {piece.owner && (
                <Row label="Owner">
                    <AccountLink address={piece.owner} />
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
                        {shortAddress(piece.provider)}
                    </Link>
                </Row>
            )}
            {piece.seed && (
                <Row label="Seed">
                    <a
                        href={tzktLink(piece.seed)}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono text-xs hover:underline"
                        title={piece.seed}
                    >
                        {shortAddress(piece.seed, 8, 6)}
                    </a>
                </Row>
            )}
            {piece.codeHash && (
                <Row label="Code hash">
                    <span className="font-mono text-xs" title={piece.codeHash}>
                        {shortAddress(piece.codeHash, 8, 6)}
                    </span>
                </Row>
            )}

            {params && Object.keys(params).length > 0 && (
                <div className="py-3">
                    <p className="pb-2 text-sm text-muted-foreground">Parameters</p>
                    <dl className="space-y-1">
                        {Object.entries(params).map(([k, v]) => (
                            <div key={k} className="flex justify-between gap-4 text-sm">
                                <dt className="min-w-0 truncate text-muted-foreground" title={k}>
                                    {k}
                                </dt>
                                {/* A parameter is part of what determines the
                                    piece, so it wraps and stays readable. */}
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

function safeParse(json: string): Record<string, unknown> | null {
    try {
        const parsed = JSON.parse(json) as unknown;
        return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
    } catch {
        return null;
    }
}
