/**
 * What the image proxy will and will not serve.
 *
 * It fetches a URL built from a path segment and returns the bytes from our
 * own origin, which is the shape of an open proxy unless the pieces are
 * constrained. The constraints are: the segment has to be a CID, the gateway
 * is ours to choose and a caller cannot name one, and the answer has to be an
 * image. A caller can ask for content, never for a host.
 *
 * The refusals need no network. The one case that does is the one that
 * matters, that a real pinned render comes back and is cacheable forever, and
 * it is skipped offline rather than failing.
 *
 * Run: npm test
 */

import { GET } from "@/app/api/img/[cid]/route";
import { IPFS_GATEWAYS } from "@/utils/ipfs";

let failures = 0;

function check(name: string, ok: boolean, detail?: string) {
    if (ok) {
        console.log(`  ok   ${name}`);
    } else {
        failures++;
        console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
    }
}

const ask = (cid: string) =>
    GET(new Request(`http://local/api/img/${cid}`), { params: Promise.resolve({ cid }) });

/** A render this provider pinned, still on chain. */
const RENDER = "QmWm6cmzx2uVxiTBkegpg34QKrnyE3EKmKuFzJ7BVkMZu5";
/** The same collection's metadata document: a real CID that is not an image. */
const DOCUMENT = "QmPWrK7MmSGt7w8yj4mjwXR67C8YSskUBB6XSZdg1ZRmkL";

async function run() {
    console.log("\nImage proxy\n");

    for (const [name, cid] of [
        ["an empty segment", ""],
        ["something that is not a cid", "notacid"],
        ["a path traversal", "../../etc/passwd"],
        ["a url", "https://evil.example/x.png"],
        ["a cid with a query on it", "QmWm6cmzx2uVxiTBkegpg34QKrnyE3EKmKuFzJ7BVkMZu5?x=1"],
    ] as const) {
        const res = await ask(cid);
        check(`${name} is refused`, res.status === 400, `got ${res.status}`);
    }

    // The gateway the route actually reads from. Probing a host we no longer
    // use meant this block skipped itself on the day that host went down, and
    // reported a pass on the day the route could not serve a single image.
    let online = true;
    try {
        await fetch(`${IPFS_GATEWAYS[0]}/`, { method: "HEAD" });
    } catch {
        online = false;
    }

    if (!online) {
        console.log("  skip gateway checks, no connection\n");
    } else {
        const res = await ask(RENDER);
        check("a pinned render is served", res.status === 200, `got ${res.status}`);
        check(
            "as an image",
            (res.headers.get("content-type") ?? "").startsWith("image/"),
            res.headers.get("content-type") ?? "none",
        );
        check(
            "cacheable forever, because a cid cannot mean other bytes",
            res.headers.get("cache-control") === "public, max-age=31536000, immutable",
            res.headers.get("cache-control") ?? "none",
        );

        // A real CID that resolves to JSON. Serving it would make this a proxy
        // for arbitrary pinned content rather than for images.
        const doc = await ask(DOCUMENT);
        check("a cid that is not an image is refused", doc.status === 502, `got ${doc.status}`);

        // A propagation delay must not be cached for a year.
        const missing = await ask("QmZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ");
        check(
            "content nobody has yet is not cached",
            missing.headers.get("cache-control") === "no-store",
            missing.headers.get("cache-control") ?? "none",
        );
    }

    console.log(
        failures === 0
            ? "\nA caller can ask for content, never for a host.\n"
            : `\n${failures} check(s) failed.\n`,
    );
    process.exit(failures === 0 ? 0 : 1);
}

run().catch((e) => {
    console.error("\nThe suite could not run:", e instanceof Error ? e.message : e);
    process.exit(1);
});
