/**
 * Extracted Aleatory piece attributes.
 */
export interface ExtractedPieceMetadata {
    seed: string | null;
    params: Record<string, unknown>;
    features: Record<string, unknown>;
}

/**
 * Extracts seed and parameters from a standard metadata object or artifactUri query params.
 */
export function extractPieceMetadata(metadata: Record<string, unknown> | null | undefined): ExtractedPieceMetadata {
    if (!metadata || typeof metadata !== "object") {
        return { seed: null, params: {}, features: {} };
    }

    let seed: string | null = null;
    const params: Record<string, unknown> = {};
    const features: Record<string, unknown> = {};

    // 1. Check top-level aleaSeed field
    if (typeof metadata.aleaSeed === "string" && metadata.aleaSeed.length > 0) {
        seed = metadata.aleaSeed;
    }

    // 2. Check aleaParams field
    if (typeof metadata.aleaParams === "string" && metadata.aleaParams.length > 0) {
        try {
            const parsed = JSON.parse(metadata.aleaParams);
            if (parsed && typeof parsed === "object") {
                Object.assign(params, parsed);
            }
        } catch {}
    } else if (metadata.aleaParams && typeof metadata.aleaParams === "object") {
        Object.assign(params, metadata.aleaParams);
    }

    // 3. Inspect attributes array (Objkt / TZIP-21 standard)
    if (Array.isArray(metadata.attributes)) {
        for (const attr of metadata.attributes) {
            if (!attr || typeof attr !== "object") continue;
            const name = String(attr.name || "");
            const val = attr.value;
            if (name === "aleaSeed" && !seed && typeof val === "string") {
                seed = val;
            } else if (name.startsWith("param:")) {
                params[name.slice(6)] = val;
            } else if (name.startsWith("p.")) {
                params[name.slice(2)] = val;
            } else if (name && val !== undefined) {
                features[name] = val;
            }
        }
    }

    // 4. Inspect query string in artifactUri if seed not found
    if (!seed && typeof metadata.artifactUri === "string" && metadata.artifactUri.includes("?")) {
        try {
            const query = new URL(metadata.artifactUri, "https://aleatory.art").searchParams;
            const querySeed = query.get("seed");
            if (querySeed) seed = querySeed;
            for (const [key, val] of query.entries()) {
                if (key.startsWith("p.")) {
                    const pName = key.slice(2);
                    if (!(pName in params)) {
                        params[pName] = val === "true" ? true : val === "false" ? false : !isNaN(Number(val)) ? Number(val) : val;
                    }
                }
            }
        } catch {}
    }

    return { seed, params, features };
}
