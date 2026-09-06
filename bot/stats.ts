import { addresses, tzkt, provider } from "./chain";

/**
 * What the platform has done, counted from the chain.
 *
 * Every address comes from the router, so this reads a network and not a
 * deployment. The render provider is the exception: it is ours specifically,
 * and the router names nobody's, because the registry lists everyone's.
 *
 * Storage says what is true now, and these are lifetime figures, so most of
 * them come from operation history.
 *
 * Money is counted where it landed, never from a contract's own bookkeeping.
 * Three marketplace generations are live and they disagree about royalties: the
 * first accrued them for later claiming, the ones after pay every recipient
 * inside the sale. What arrived at the treasury is one question with one
 * answer, and stays the right question through the next redeploy.
 */

export interface PlatformStats {
    /** Collections originated by any factory the router has ever pointed at. */
    generators: number;
    /** Tokens minted across all of them. */
    pieces: number;
    /** What collectors have paid to mint, price and render gas together. */
    mintedMutez: number;

    /** Reached the treasury: swept marketplace fees, and our royalty shares. */
    treasuryMutez: number;
    /** Fees the marketplaces and factories hold, not yet swept. */
    unsweptMutez: number;
    /** Our render provider's lifetime intake. */
    renderGasMutez: number;
    /** The three above. */
    earnedMutez: number;

    /** Empty when the router answered and nothing else failed. */
    problems: string[];
}

export const EMPTY_STATS: PlatformStats = {
    generators: 0,
    pieces: 0,
    mintedMutez: 0,
    treasuryMutez: 0,
    unsweptMutez: 0,
    renderGasMutez: 0,
    earnedMutez: 0,
    problems: ["nothing has been read yet"],
};

/** Discord's own ceiling on a channel name. */
const MAX_NAME = 100;

/** Thousands separators, because 1247 in a sidebar reads as a year. */
const count = (n: number) => n.toLocaleString("en-US");

/**
 * Tez, short enough for a channel name: two decimals up to a thousand, then
 * thousands and millions abbreviated.
 */
function tez(mutez: number): string {
    const value = mutez / 1_000_000;
    if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
    if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
    if (value === 0) return "0";
    return value.toFixed(2).replace(/\.?0+$/, "");
}

/**
 * A label with its figures filled in. An unknown placeholder is left as
 * written, so a typo appears in the channel name as itself.
 */
export function render(label: string, stats: PlatformStats): string {
    const values: Record<string, string> = {
        generators: count(stats.generators),
        pieces: count(stats.pieces),
        minted: tez(stats.mintedMutez),
        earned: tez(stats.earnedMutez),
        treasury: tez(stats.treasuryMutez),
        unswept: tez(stats.unsweptMutez),
        renderGas: tez(stats.renderGasMutez),
    };
    return label
        .replace(/\{(\w+)\}/g, (whole, key: string) => values[key] ?? whole)
        .slice(0, MAX_NAME);
}

const PAGE = 1000;

/**
 * One numeric field, added up across every page. TzKT caps a page, and a query
 * that returns the first one reads as a total while being a page.
 */
async function sumOf(path: string): Promise<number> {
    let total = 0;
    for (let offset = 0; ; offset += PAGE) {
        const page = await tzkt<number[]>(`${path}&select=amount&limit=${PAGE}&offset=${offset}`);
        for (const amount of page) total += amount;
        if (page.length < PAGE) return total;
    }
}

/** Contracts a list of factories originated, which is every generator. */
export async function collectionsOf(factories: string[]): Promise<string[]> {
    // The router's list can name one twice: `add_factory` conses on, so
    // re-pointing at an earlier factory adds a second entry.
    const unique = [...new Set(factories.filter(Boolean))];
    if (unique.length === 0) return [];
    const out: string[] = [];
    for (let offset = 0; ; offset += PAGE) {
        const page = await tzkt<string[]>(
            `/v1/contracts?creator.in=${unique.join(",")}&select=address&limit=${PAGE}&offset=${offset}`,
        );
        out.push(...page);
        if (page.length < PAGE) return out;
    }
}

export async function platformStats(): Promise<PlatformStats> {
    const problems: string[] = [];
    // The one address that has to be configured, so failing to read it is a
    // configuration problem and not a bad tick.
    let where;
    try {
        where = await addresses();
    } catch (e) {
        return {
            ...EMPTY_STATS,
            problems: [`router: ${e instanceof Error ? e.message : "could not be read"}`],
        };
    }

    if (where.factories.length === 0 && where.marketplaces.length === 0) {
        return { ...EMPTY_STATS, problems: ["the router answered with nothing"] };
    }

    const collections = await collectionsOf(where.factories);

    // Each figure on its own, so one failure costs one number.
    const attempt = async <T>(label: string, read: () => Promise<T>, fallback: T): Promise<T> => {
        try {
            return await read();
        } catch (e) {
            problems.push(`${label}: ${e instanceof Error ? e.message : "failed"}`);
            return fallback;
        }
    };

    const inList = collections.join(",");

    const [pieces, mintedMutez, renderGasMutez, treasury] = await Promise.all([
        attempt(
            "pieces",
            async () =>
                collections.length === 0
                    ? 0
                    : await tzkt<number>(`/v1/tokens/count?contract.in=${inList}`),
            0,
        ),
        attempt(
            "minted",
            async () =>
                collections.length === 0
                    ? 0
                    : await sumOf(
                          `/v1/operations/transactions?entrypoint=mint&status=applied&target.in=${inList}`,
                      ),
            0,
        ),
        // Every transfer in, which is what the provider has earned. Its balance
        // is what it is holding, and goes down when the operator withdraws.
        attempt(
            "render gas",
            async () =>
                provider()
                    ? await sumOf(`/v1/operations/transactions?target=${provider()}&status=applied`)
                    : 0,
            0,
        ),
        attempt("treasury", () => treasuryIncome(where.marketplaces, where.factories), {
            arrived: 0,
            unswept: 0,
        }),
    ]);

    if (!provider()) problems.push("render gas: ALEA_PROVIDER_ADDRESS is not set");

    const earnedMutez = treasury.arrived + treasury.unswept + renderGasMutez;

    return {
        generators: collections.length,
        pieces,
        mintedMutez,
        treasuryMutez: treasury.arrived,
        unsweptMutez: treasury.unswept,
        renderGasMutez,
        earnedMutez,
        problems,
    };
}

/**
 * What the platform's share has come to, wherever it sits. `arrived` is what
 * our contracts have sent the treasury; `unswept` is what they still hold for
 * it, which anyone can claim at any time because the destination is fixed in
 * storage.
 *
 * Both cover every marketplace and factory the router has named, so a retired
 * contract holding a fee is still counted.
 */
async function treasuryIncome(
    marketplaces: string[],
    factories: string[],
): Promise<{ arrived: number; unswept: number }> {
    const contracts = [...marketplaces, ...factories].filter(Boolean);
    if (contracts.length === 0) return { arrived: 0, unswept: 0 };

    const storages = await Promise.all(
        contracts.map((c) =>
            tzkt<{ treasury?: string; fees_accrued?: string }>(`/v1/contracts/${c}/storage`),
        ),
    );

    const unswept = storages.reduce((sum, s) => sum + Number(s.fees_accrued ?? 0), 0);

    // Every treasury any of them names. One address in practice.
    const treasuries = [...new Set(storages.map((s) => s.treasury).filter(Boolean))] as string[];
    if (treasuries.length === 0) return { arrived: 0, unswept };

    let arrived = 0;
    for (const treasury of treasuries) {
        arrived += await sumOf(
            `/v1/operations/transactions?target=${treasury}&sender.in=${contracts.join(",")}&status=applied`,
        );
    }

    return { arrived, unswept };
}
