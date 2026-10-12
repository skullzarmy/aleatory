import { BRAND } from "@/lib/config";

/**
 * Structured data, for the readers that are not people: a piece as a
 * `VisualArtwork` with a creator, an image and a date.
 *
 * A script tag rather than `metadata`, which has no field for it. `<` is
 * escaped, because the values come from chain state and a generator named
 * `</script>` would otherwise close this one.
 *
 * `Collection` and `collectionSize` are schema.org's vocabulary, not ours, so
 * they keep that spelling whatever we call the thing on screen.
 */
function Ld({ data }: { data: Record<string, unknown> }) {
    return (
        <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{
                __html: JSON.stringify(data).replace(/</g, "\\u003c"),
            }}
        />
    );
}

export function PieceJsonLd({
    name,
    description,
    imageUrl,
    creators,
    mintedAt,
    url,
    generatorName,
}: {
    name: string;
    description?: string;
    imageUrl?: string;
    /** Who made it. schema.org takes a list, which a collaboration needs. */
    creators?: string[];
    mintedAt?: string;
    url: string;
    generatorName?: string;
}) {
    return (
        <Ld
            data={{
                "@context": "https://schema.org",
                "@type": "VisualArtwork",
                name,
                url,
                ...(description ? { description } : {}),
                ...(imageUrl ? { image: imageUrl } : {}),
                ...(mintedAt ? { dateCreated: mintedAt } : {}),
                ...(creators?.length
                    ? {
                          creator: creators.map((c) => ({
                              "@type": "Person",
                              identifier: c,
                          })),
                      }
                    : {}),
                ...(generatorName
                    ? { isPartOf: { "@type": "Collection", name: generatorName } }
                    : {}),
                artform: "Generative art",
                artMedium: "Code",
                isAccessibleForFree: true,
            }}
        />
    );
}

export function GeneratorJsonLd({
    name,
    description,
    imageUrl,
    creators,
    url,
    size,
}: {
    name: string;
    description?: string;
    imageUrl?: string;
    /** Who made it. schema.org takes a list, which a collaboration needs. */
    creators?: string[];
    url: string;
    size?: number;
}) {
    return (
        <Ld
            data={{
                "@context": "https://schema.org",
                "@type": "Collection",
                name,
                url,
                ...(description ? { description } : {}),
                ...(imageUrl ? { image: imageUrl } : {}),
                ...(creators?.length
                    ? {
                          creator: creators.map((c) => ({
                              "@type": "Person",
                              identifier: c,
                          })),
                      }
                    : {}),
                ...(size ? { collectionSize: size } : {}),
            }}
        />
    );
}

export function SiteJsonLd() {
    return (
        <Ld
            data={{
                "@context": "https://schema.org",
                "@type": "WebSite",
                name: BRAND.name,
                url: BRAND.url,
                description: BRAND.description,
            }}
        />
    );
}
