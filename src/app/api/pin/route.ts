import { NextResponse } from "next/server";

/**
 * Pin an artist's source, and the documents that go with it. Publishing
 * needs an `ipfs://` pointer before the deploy operation is built, and pinning
 * needs a credential that cannot be in a browser.
 *
 * Unauthenticated, because requiring an account to publish would undo what the
 * studio is for, which makes this an open pinning endpoint on our account. The
 * limits are the whole defence:
 *
 *   - a ceiling on source, well above anything publishable
 *   - JSON documents capped far below that
 *   - `content-type` fixed here, so nothing decides its own media type
 *
 * An artist can pin anywhere else and publish through the `ipfs://` field on
 * the deploy form.
 */

const PINATA_JWT = process.env.PINATA_JWT || "";

/**
 * Source is pinned for one case only: a generator too big to walk on chain,
 * which publishes behind an `ipfs://` pointer instead. So this cannot be one
 * operation's worth of bytes — everything that reaches this path is larger
 * than that by definition, and while it was, the pointer route answered 413
 * for every generator that needed it.
 */
const MAX_SOURCE_BYTES = 1_000_000;
const MAX_DOCUMENT_BYTES = 8_192;

type Body =
    | { kind: "source"; content: string; name?: string }
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
        if (body.kind === "source") {
            if (typeof body.content !== "string") {
                return NextResponse.json({ error: "Expected a string." }, { status: 400 });
            }
            const bytes = new TextEncoder().encode(body.content);
            if (bytes.length > MAX_SOURCE_BYTES) {
                return NextResponse.json(
                    {
                        error: `That source is ${bytes.length.toLocaleString()} bytes, past the ${MAX_SOURCE_BYTES.toLocaleString()} this accepts.`,
                    },
                    { status: 413 },
                );
            }
            const uri = await pinFile(bytes, body.name);
            await warmGateway(uri);
            return NextResponse.json({ uri });
        }

        if (body.kind === "image") {
            // A generator cover, captured in the artist's own browser.
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
            const uri = await pinFile(bytes, body.name, "image/png");
            await warmGateway(uri);
            return NextResponse.json({ uri });
        }

        if (body.kind === "document") {
            const json = JSON.stringify(body.content);
            if (new TextEncoder().encode(json).length > MAX_DOCUMENT_BYTES) {
                return NextResponse.json({ error: "Document too large." }, { status: 413 });
            }
            const uri = await pinJson(body.content, body.name);
            await warmGateway(uri);
            return NextResponse.json({ uri });
        }

        return NextResponse.json({ error: "Unknown kind." }, { status: 400 });
    } catch (e) {
        // The upstream error is not echoed back: it can carry account detail.
        console.error("pin failed", e);
        return NextResponse.json({ error: "Pinning failed upstream." }, { status: 502 });
    }
}

async function pinFile(bytes: Uint8Array, name?: string, type = "text/html"): Promise<string> {
    const form = new FormData();
    // The type is ours, not the caller's: it is decided by which branch above
    // accepted the body, never by anything the caller sent.
    form.append(
        "file",
        new Blob([bytes.buffer as ArrayBuffer], { type }),
        safeName(name) || (type === "image/png" ? "cover.png" : "source.html"),
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

/**
 * Ask the public gateway for what was just pinned. The site reads through a
 * gateway that is not the pinning service, and one has to fetch content across
 * the network before it can serve it. Until something asks, it never looks.
 */
async function warmGateway(uri: string): Promise<void> {
    const cid = uri.replace(/^ipfs:\/\//, "").split(/[/?#]/)[0];
    if (!cid) return;
    const base = (process.env.NEXT_PUBLIC_IPFS_GATEWAY || "https://ipfs.fileship.xyz").replace(
        /\/+$/,
        "",
    );
    await fetch(`${base}/${cid}`, { signal: AbortSignal.timeout(20_000) }).catch(() => {});
}

/** A caller-supplied name reaches a third-party account, so it is reduced. */
function safeName(name?: string): string {
    return (name ?? "").replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 64);
}
