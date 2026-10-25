import { blake2b256 } from "./integrity.js";
import type { LibrarySpec } from "./parser.js";

export interface ResolvedLibrary {
    spec: LibrarySpec;
    source: string;
    hash: string;
}

export interface ResolverOptions {
    /**
     * Custom URL formatter for resolving a package to a CDN or proxy URL.
     * Defaults to jsDelivr.
     */
    cdnUrl?: (spec: LibrarySpec) => string;
    /**
     * Custom fetch function (e.g. for Node environments with custom proxies).
     */
    fetch?: typeof fetch;
}

const libraryCache = new Map<string, ResolvedLibrary>();

/**
 * Default CDN URL builder pointing to jsDelivr.
 */
export function defaultCdnUrl(spec: LibrarySpec): string {
    const subpath = spec.path ? `/${spec.path.replace(/^\//, "")}` : "";
    return `https://cdn.jsdelivr.net/npm/${spec.id}@${spec.version}${subpath}`;
}

/**
 * Resolves a single library dependency, verifying its integrity if an expected hash is provided.
 */
export async function resolveLibrary(
    spec: LibrarySpec,
    options: ResolverOptions = {},
): Promise<ResolvedLibrary> {
    const cacheKey = spec.hash || `${spec.id}@${spec.version}/${spec.path}`;
    const cached = libraryCache.get(cacheKey);
    if (cached) return cached;

    const fetchFn = options.fetch || globalThis.fetch;
    const url = options.cdnUrl ? options.cdnUrl(spec) : defaultCdnUrl(spec);

    const response = await fetchFn(url);
    if (!response.ok) {
        throw new Error(`Failed to fetch ${spec.id}@${spec.version} from ${url} (${response.status})`);
    }

    const source = await response.text();
    const hash = blake2b256(source);

    if (spec.hash && hash !== spec.hash) {
        throw new Error(
            `Integrity check failed for ${spec.id}@${spec.version}. Expected hash ${spec.hash}, got ${hash}`,
        );
    }

    const resolved: ResolvedLibrary = { spec, source, hash };
    libraryCache.set(cacheKey, resolved);
    if (spec.hash) {
        libraryCache.set(`${spec.id}@${spec.version}/${spec.path}`, resolved);
    }

    return resolved;
}

/**
 * Resolves multiple library dependencies in parallel, preserving declared order.
 */
export async function resolveLibraries(
    specs: LibrarySpec[],
    options: ResolverOptions = {},
): Promise<ResolvedLibrary[]> {
    return Promise.all(specs.map((spec) => resolveLibrary(spec, options)));
}
