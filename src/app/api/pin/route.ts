import { NextResponse } from "next/server";

/**
 * Pin an artist's generator, and the documents that go with it.
 *
 * This exists because publishing needs an `ipfs://` pointer before the deploy
 * operation is built, and pinning needs a credential that cannot be in a
 * browser. It is deliberately the narrowest thing that works: three known
 * shapes, a hard size ceiling, and no ability to name or overwrite anything.
 *
 * It is unauthenticated, because requiring an account to publish would undo
 * the thing the studio is for. That makes it an open pinning endpoint on our
 * account, so the limits below are the whole defence and they are set to what
 * a real generator needs rather than to what is comfortable:
 *
 *   - one operation's worth of bytes, since a generator larger than the
 *     protocol's operation limit cannot be deployed anyway
 *   - JSON documents capped far below that, they are a few hundred bytes
 *   - `content-type` fixed by us, so nothing decides its own media type
 *
 * An artist who would rather not use it can pin anywhere and publish through
 * the plain `ipfs://` field on the deploy form.
 */

const PINATA_JWT = process.env.PINATA_JWT || "";

/**
 * The protocol's operation ceiling. A generator above this cannot be carried
 * by the deploy operation, so pinning it would only produce a pointer that
 * fails at signature.
 */
const MAX_GENERATOR_BYTES = 32_768;
const MAX_DOCUMENT_BYTES = 8_192;

type Body =
    | { kind: "generator"; content: string; name?: string }
    | { kind: "document"; content: unknown; name?: string }
    | { kind: "image"; content: string; name?: string };

/** A cover capture. Generous, because a 1000px PNG is not small. */
const MAX_IMAGE_BYTES = 8_000_000;

export async function POST(request: Request) {
    if (!PINATA_JWT) {
        return NextResponse.json({ error: "Pinning is not configured." }, { status: 503 });
    }

    let body: Body;
    try {
        body = (await request.json()) as Body;
    } catch {
        return NextResponse.json({ error: "Expected JSON." }, { status: 400 });
    }

    try {
        if (body.kind === "generator") {
            if (typeof body.content !== "string") {
                return NextResponse.json({ error: "Expected a string." }, { status: 400 });
            }
            const bytes = new TextEncoder().encode(body.content);
            if (bytes.length > MAX_GENERATOR_BYTES) {
                return NextResponse.json(
                    {
                        error: `That generator is ${bytes.length.toLocaleString()} bytes. One operation carries ${MAX_GENERATOR_BYTES.toLocaleString()}, so it could not be deployed even if it were pinned.`,
                    },
                    { status: 413 },
                );
            }
            return NextResponse.json({ uri: await pinFile(bytes, body.name) });
        }

        if (body.kind === "image") {
            // A collection cover, captured in the artist's own browser. It is
            // marketing rather than a token's image, so nothing depends on it
            // having come from a provider.
            const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(body.content ?? "");
            if (!match) {
                return NextResponse.json(
                    { error: "Expected a base64 PNG data URL." },
                    { status: 400 },
                );
            }
            const bytes = Uint8Array.from(Buffer.from(match[1], "base64"));
            if (bytes.length > MAX_IMAGE_BYTES) {
                return NextResponse.json({ error: "Image too large." }, { status: 413 });
            }
            return NextResponse.json({
                uri: await pinFile(bytes, body.name, "image/png"),
            });
        }

        if (body.kind === "document") {
            const json = JSON.stringify(body.content);
            if (new TextEncoder().encode(json).length > MAX_DOCUMENT_BYTES) {
                return NextResponse.json({ error: "Document too large." }, { status: 413 });
            }
            return NextResponse.json({ uri: await pinJson(body.content, body.name) });
        }

        return NextResponse.json({ error: "Unknown kind." }, { status: 400 });
    } catch (e) {
        // The upstream error is not echoed back: it can carry account detail.
        console.error("pin failed", e);
        return NextResponse.json({ error: "Pinning failed upstream." }, { status: 502 });
    }
}

async function pinFile(
    bytes: Uint8Array,
    name?: string,
    type = "text/html",
): Promise<string> {
    const form = new FormData();
    // The type is ours, not the caller's: it is decided by which branch above
    // accepted the body, never by anything the caller sent.
    form.append(
        "file",
        new Blob([bytes.buffer as ArrayBuffer], { type }),
        safeName(name) || (type === "image/png" ? "cover.png" : "generator.html"),
    );
    const res = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
        method: "POST",
        headers: { authorization: `Bearer ${PINATA_JWT}` },
        body: form,
    });
    if (!res.ok) throw new Error(`pin ${res.status}`);
    return `ipfs://${((await res.json()) as { IpfsHash: string }).IpfsHash}`;
}

async function pinJson(doc: unknown, name?: string): Promise<string> {
    const res = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
        method: "POST",
        headers: {
            authorization: `Bearer ${PINATA_JWT}`,
            "content-type": "application/json",
        },
        body: JSON.stringify({
            pinataContent: doc,
            pinataMetadata: { name: safeName(name) || "document.json" },
        }),
    });
    if (!res.ok) throw new Error(`pin json ${res.status}`);
    return `ipfs://${((await res.json()) as { IpfsHash: string }).IpfsHash}`;
}

/** A caller-supplied name reaches a third-party account, so it is reduced. */
function safeName(name?: string): string {
    return (name ?? "").replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 64);
}
