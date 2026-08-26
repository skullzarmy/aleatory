/**
 * Render worker. Cloudflare Browser Rendering.
 *
 * In: generator code, a seed, parameters, a capture spec.
 * Out: image bytes.
 *
 * It holds no chain access, no wallet key, no pinning credentials and no
 * database, so a compromised worker leaks nothing and moving to another
 * vendor is a one URL change. Everything privileged sits behind it in the
 * Netlify function that calls this.
 *
 * The same path serves sandbox previews and mints, so the image an artist
 * approves is produced by the code that produces the one on chain.
 *
 * Deploy:
 *   npx wrangler deploy
 */
import puppeteer, { type Browser } from "@cloudflare/puppeteer";

export interface Env {
    BROWSER: Fetcher;
    /** Shared secret with the Netlify function. workers.dev URLs are public. */
    RENDER_TOKEN: string;
}

interface RenderRequest {
    /** The generator's HTML, inlined. */
    html: string;
    seed: string;
    params?: string;
    width?: number;
    height?: number;
    /** Milliseconds to wait for the piece to signal it is ready. */
    timeoutMs?: number;
}

const MAX_TIMEOUT_MS = 30_000;
const HARD_KILL_MS = 45_000;
const LAUNCH_TIMEOUT_MS = 20_000;
const MAX_BODY_BYTES = 8 * 1024 * 1024;

function constantTimeEquals(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}

/** Reject rather than hang, since a hung launch leaves nothing to kill. */
function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
    return Promise.race([
        p,
        new Promise<T>((_, reject) =>
            setTimeout(() => reject(new Error(`${what} timed out`)), ms),
        ),
    ]);
}

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        if (request.method !== "POST") {
            return new Response("POST only", { status: 405 });
        }
        // Without a secret configured this worker is open to the internet,
        // since a workers.dev URL is public. Refuse to run rather than fall
        // back to comparing against the string "Bearer undefined".
        if (!env.RENDER_TOKEN) {
            return new Response("Not configured", { status: 503 });
        }
        const given = (request.headers.get("authorization") || "").replace(/^Bearer /, "");
        if (!constantTimeEquals(given, env.RENDER_TOKEN)) {
            return new Response("Unauthorized", { status: 401 });
        }

        // A body this large is a memory problem before it is a render.
        const declared = Number(request.headers.get("content-length") || 0);
        if (declared > MAX_BODY_BYTES) {
            return new Response("Payload too large", { status: 413 });
        }

        let body: RenderRequest;
        try {
            body = (await request.json()) as RenderRequest;
        } catch {
            return new Response("Bad JSON", { status: 400 });
        }
        if (!body.html || !body.seed) {
            return new Response("html and seed are required", { status: 400 });
        }

        const width = clamp(body.width ?? 1000, 64, 2400);
        const height = clamp(body.height ?? 1000, 64, 2400);
        const timeoutMs = clamp(body.timeoutMs ?? 10_000, 500, MAX_TIMEOUT_MS);

        let browser: Browser | null = null;
        const killer = setTimeout(() => {
            // An artist supplies the capture timeout, so the piece cannot be
            // trusted to end on its own. This one is ours.
            void browser?.close();
        }, HARD_KILL_MS);

        try {
            browser = await withTimeout(
                puppeteer.launch(env.BROWSER),
                LAUNCH_TIMEOUT_MS,
                "browser launch",
            );
            const page = await browser.newPage();
            await page.setViewport({ width, height, deviceScaleFactor: 1 });

            // Interception goes on before any navigation. A script tag, an
            // image, or a fetch in the first bytes of the document would
            // otherwise escape, which is both an SSRF from inside this
            // network and a render that depends on something external.
            await page.setRequestInterception(true);
            page.on("request", (req) => {
                const url = req.url();
                if (url.startsWith("data:") || url.startsWith("blob:") || url === "about:blank") {
                    void req.continue();
                    return;
                }
                void req.abort();
            });

            // Determinism harness, installed before the document runs. The
            // seeded stream replaces Math.random, and the clock is frozen, so
            // a piece that reads the date renders the same way in 2029.
            await page.evaluateOnNewDocument(harness(), body.seed, body.params ?? "");

            // Request interception covers HTTP and misses WebSocket and
            // WebRTC, so the document carries a policy of its own. This is
            // the control; the JS overrides in the harness are reporting.
            const csp =
                `<meta http-equiv="Content-Security-Policy" content="` +
                `default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; ` +
                `style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; ` +
                `font-src data:; connect-src 'none'; frame-src 'none'; child-src 'none'; ` +
                `object-src 'none'; base-uri 'none'; form-action 'none'">`;
            await page.setContent(csp + body.html, { waitUntil: "domcontentloaded" });

            // The piece signals its capture point. Falling through on timeout
            // captures whatever is on screen, which is what a piece without a
            // ready signal means.
            await page
                .waitForFunction("window.__ALEA_READY__ === true", { timeout: timeoutMs })
                .catch(() => undefined);

            const shot = (await page.screenshot({ type: "png" })) as Uint8Array;

            return new Response(shot, {
                headers: {
                    "content-type": "image/png",
                    "cache-control": "no-store",
                },
            });
        } catch (e) {
            return new Response(`Render failed: ${(e as Error).message}`, { status: 500 });
        } finally {
            clearTimeout(killer);
            await browser?.close();
        }
    },
};

function clamp(n: number, lo: number, hi: number): number {
    return Math.min(hi, Math.max(lo, Math.round(n)));
}

/**
 * Runs in the page before the artist's code.
 *
 * Two substitutions make a render reproducible: a seeded PRNG in place of
 * Math.random, and a frozen clock. Both are read by pieces that were written
 * without either in mind, so both have to be in place before the first line
 * of artist code executes.
 */
function harness() {
    return (seed: string, paramsJson: string) => {
        // sfc32 over a hash of the seed. Deterministic, fast, and the same
        // stream every renderer produces from the same operation hash.
        function xmur3(str: string) {
            let h = 1779033703 ^ str.length;
            for (let i = 0; i < str.length; i++) {
                h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
                h = (h << 13) | (h >>> 19);
            }
            return () => {
                h = Math.imul(h ^ (h >>> 16), 2246822507);
                h = Math.imul(h ^ (h >>> 13), 3266489909);
                h ^= h >>> 16;
                return h >>> 0;
            };
        }
        function sfc32(a: number, b: number, c: number, d: number) {
            return () => {
                a >>>= 0;
                b >>>= 0;
                c >>>= 0;
                d >>>= 0;
                let t = (a + b) | 0;
                a = b ^ (b >>> 9);
                b = (c + (c << 3)) | 0;
                c = (c << 21) | (c >>> 11);
                d = (d + 1) | 0;
                t = (t + d) | 0;
                c = (c + t) | 0;
                return (t >>> 0) / 4294967296;
            };
        }
        const s = xmur3(seed);
        const rand = sfc32(s(), s(), s(), s());

        let mathRandomCalls = 0;
        Math.random = () => {
            mathRandomCalls++;
            return rand();
        };

        // A frozen clock. A piece that branches on the date renders the same
        // way whenever it is rendered.
        const FIXED = 0;
        const RealDate = Date;
        // @ts-expect-error replacing the global on purpose
        Date = class extends RealDate {
            constructor(...args: unknown[]) {
                if (args.length === 0) super(FIXED);
                else super(...(args as []));
            }
            static now() {
                return FIXED;
            }
        };
        performance.now = () => 0;

        const params = (() => {
            try {
                return paramsJson ? JSON.parse(paramsJson) : {};
            } catch {
                return {};
            }
        })();

        const w = window as unknown as Record<string, unknown>;
        w.__ALEA_READY__ = false;
        w.$alea = {
            seed,
            random: rand,
            params,
            param: (name: string, fallback?: unknown) =>
                name in params ? (params as Record<string, unknown>)[name] : fallback,
            ready: () => {
                w.__ALEA_READY__ = true;
            },
            get mathRandomCalls() {
                return mathRandomCalls;
            },
        };
            hash: seed,
            rand,
            getParam: (n: string) => (params as Record<string, unknown>)[n],
            getParams: () => params,
            preview: () => {
                w.__ALEA_READY__ = true;
            },
        };
    };
}
