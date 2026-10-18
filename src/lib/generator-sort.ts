import type { GeneratorSummary } from "./generator";

export type GeneratorSortKey =
    | "created-desc"
    | "created-asc"
    | "remaining-desc"
    | "remaining-asc"
    | "minted-desc"
    | "minted-asc"
    | "price-desc"
    | "price-asc"
    | "artist-asc"
    | "artist-desc";

export function parseSortKey(raw?: string | null): GeneratorSortKey {
    switch (raw) {
        case "created-asc":
        case "oldest":
            return "created-asc";
        case "remaining-desc":
            return "remaining-desc";
        case "remaining-asc":
            return "remaining-asc";
        case "minted-desc":
        case "minted":
            return "minted-desc";
        case "minted-asc":
            return "minted-asc";
        case "price-desc":
            return "price-desc";
        case "price-asc":
        case "price":
            return "price-asc";
        case "artist-asc":
        case "artist":
            return "artist-asc";
        case "artist-desc":
            return "artist-desc";
        case "created-desc":
        case "newest":
        default:
            return "created-desc";
    }
}

export function remainingCount(g: GeneratorSummary): number {
    if (g.editionSize === 0) return Number.POSITIVE_INFINITY;
    return Math.max(0, g.editionSize - g.minted);
}

export function sortGenerators(
    generators: GeneratorSummary[],
    sortKey: GeneratorSortKey,
): GeneratorSummary[] {
    const list = [...generators];

    const getPrice = (g: GeneratorSummary): bigint => {
        if (!g.priceMutez) return 0n;
        try {
            return BigInt(g.priceMutez);
        } catch {
            return 0n;
        }
    };

    const getArtist = (g: GeneratorSummary): string => {
        return (g.artistResolvedName || g.artists?.[0] || g.name || g.address).toLowerCase();
    };

    return list.sort((a, b) => {
        let diff = 0;

        switch (sortKey) {
            case "created-desc":
                diff = (b.firstActivity ?? "").localeCompare(a.firstActivity ?? "");
                break;
            case "created-asc":
                diff = (a.firstActivity ?? "").localeCompare(b.firstActivity ?? "");
                break;
            case "remaining-desc": {
                const remA = remainingCount(a);
                const remB = remainingCount(b);
                if (remA !== remB) {
                    diff = remB - remA;
                }
                break;
            }
            case "remaining-asc": {
                const remA = remainingCount(a);
                const remB = remainingCount(b);
                // Active generators with positive remaining supply precede sold-out ones.
                if (remA === 0 && remB > 0) return 1;
                if (remB === 0 && remA > 0) return -1;
                if (remA !== remB) {
                    diff = remA - remB;
                }
                break;
            }
            case "minted-desc":
                diff = b.minted - a.minted;
                break;
            case "minted-asc":
                diff = a.minted - b.minted;
                break;
            case "price-desc": {
                const pA = getPrice(a);
                const pB = getPrice(b);
                if (pA !== pB) {
                    diff = pB > pA ? 1 : -1;
                }
                break;
            }
            case "price-asc": {
                const pA = getPrice(a);
                const pB = getPrice(b);
                if (pA !== pB) {
                    diff = pA > pB ? 1 : -1;
                }
                break;
            }
            case "artist-asc":
                diff = getArtist(a).localeCompare(getArtist(b), undefined, {
                    sensitivity: "base",
                });
                break;
            case "artist-desc":
                diff = getArtist(b).localeCompare(getArtist(a), undefined, {
                    sensitivity: "base",
                });
                break;
        }

        if (diff === 0) {
            diff = (b.firstActivity ?? "").localeCompare(a.firstActivity ?? "");
        }
        return diff;
    });
}
