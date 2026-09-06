import { BRAND } from "@/lib/config";

/**
 * Structured data, for the readers that are not people: a piece as a
 * `VisualArtwork` with a creator, an image and a date.
 *
 * A script tag rather than `metadata`, which has no field for it. `<` is
 * escaped, because the values come from chain state and a collection named
 * `</script>` would otherwise close this one.
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
    creator,
    mintedAt,
    url,
    collectionName,
}: {
    name: string;
    description?: string;
    imageUrl?: string;
    creator?: string;
    mintedAt?: string;
    url: string;
    collectionName?: string;
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
                ...(creator ? { creator: { "@type": "Person", identifier: creator } } : {}),
                ...(collectionName
                    ? { isPartOf: { "@type": "Collection", name: collectionName } }
                    : {}),
                artform: "Generative art",
                artMedium: "Code",
                isAccessibleForFree: true,
            }}
        />
    );
}

export function CollectionJsonLd({
    name,
    description,
    imageUrl,
    creator,
    url,
    size,
}: {
    name: string;
    description?: string;
    imageUrl?: string;
    creator?: string;
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
                ...(creator ? { creator: { "@type": "Person", identifier: creator } } : {}),
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
