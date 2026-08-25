/**
 * Aleatory, the sandbox frame.
 *
 * One piece, one seed, one frame. The frame is `sandbox="allow-scripts"` with no
 * `allow-same-origin`, so the piece runs in an opaque origin with no access to
 * the page, no storage, and, via CSP, no network at all.
 *
 * The document is NOT handed over as `srcdoc`, and that is the whole subtlety
 * here. A srcdoc document inherits the parent page's CSP, and the site forbids
 * inline scripts; a piece is nothing but inline scripts. So srcdoc frames render
 * blank in production and under `netlify dev`, while working fine under plain
 * `vite`, which sets no headers.
 *
 * Instead the frame loads `/sandbox.html`, which is a real URL and therefore
 * governed by its own response headers (see netlify.toml). That shell asks for
 * the document, we post it in, and it writes it.
 *
 * Everything the lab knows about a run comes back through postMessage: the
 * capture digest, the declared features, and every violation the harness saw.
 */
import { type CSSProperties, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ParamSpec, ParamValues } from "../../lib/aleatory/params";
import type { FrameMessage, Violation } from "../../lib/aleatory/runtime";
import { buildSandboxDoc } from "../../lib/aleatory/sandbox";

/** Static shell in public/. Served by Vite and Netlify alike, and, critically , 
 *  carries its own CSP rather than inheriting the site's. */
const SHELL_URL = "/sandbox/index.html";

export interface RunResult {
    seed: string;
    digest: string;
    image: string | null;
    source: "canvas" | "svg" | "none";
    features: Record<string, string | number | boolean>;
    violations: Violation[];
    /** Diagnostic, not a fault, see FrameMessage. */
    mathRandomCalls: number;
    elapsed: number;
    autoCaptured: boolean;
    errors: string[];
}

interface Props {
    html: string;
    seed: string;
    deps?: string[];
    /** Resolved mint-time parameter values. */
    params?: ParamValues;
    /** The declaration they were resolved against. */
    paramsSchema?: ParamSpec[];
    /** Ask the frame to send back the capture image, not just its digest. */
    wantImage?: boolean;
    timeout?: number;
    /** Change to force a re-run of the same seed (the determinism check does this). */
    runKey?: string | number;
    onResult?: (result: RunResult) => void;
    onError?: (message: string) => void;
    /** An fxhash-era piece that declared its params in code. Offered so the
     *  studio can import the declaration instead of stranding it. */
    onParamsDeclared?: (declaration: unknown[]) => void;
    style?: CSSProperties;
    title?: string;
}

export default function SandboxFrame({
    html,
    seed,
    deps,
    params,
    paramsSchema,
    wantImage = false,
    timeout = 8000,
    runKey,
    onResult,
    onError,
    onParamsDeclared,
    style,
    title = "generative piece",
}: Props) {
    const frameRef = useRef<HTMLIFrameElement>(null);
    // `run` increments on every rebuild and keys the frame, so each run gets a
    // brand-new shell rather than a document swapped underneath a live one.
    const [{ doc, run }, setDoc] = useState<{ doc: string; run: number }>({ doc: "", run: 0 });

    // The document currently owed to the shell. Held in a ref because the shell
    // may ask for it from an event handler that was registered before it existed.
    const docRef = useRef("");
    docRef.current = doc;

    // Errors and violations can arrive before the ready message; collect them
    // so the result carries everything that happened during the run.
    const errorsRef = useRef<string[]>([]);
    const violationsRef = useRef<Violation[]>([]);

    // Keep the latest callbacks without making the frame re-mount when a parent
    // re-renders, a remount is a re-run, and re-runs must be deliberate.
    const onResultRef = useRef(onResult);
    const onErrorRef = useRef(onError);
    const onParamsDeclaredRef = useRef(onParamsDeclared);
    useEffect(() => {
        onResultRef.current = onResult;
        onErrorRef.current = onError;
        onParamsDeclaredRef.current = onParamsDeclared;
    });

    // Params and their declaration are objects, so a parent re-render hands us
    // new identities for identical values. Comparing the serialized form is what
    // keeps a re-render from being a re-run, the frame rebuilds when the values
    // actually change, and only then.
    const paramsKey = useMemo(() => JSON.stringify(params ?? {}), [params]);
    const schemaKey = useMemo(() => JSON.stringify(paramsSchema ?? []), [paramsSchema]);

    useEffect(() => {
        errorsRef.current = [];
        violationsRef.current = [];
        const next = buildSandboxDoc(html, {
            seed,
            params: JSON.parse(paramsKey) as Record<string, unknown>,
            paramsSchema: JSON.parse(schemaKey) as ParamSpec[],
            wantImage,
            timeout,
            deps,
        });
        setDoc((prev) => ({ doc: next, run: prev.run + 1 }));
    }, [html, seed, deps, paramsKey, schemaKey, wantImage, timeout, runKey]);

    /** Hand the built document to the shell. Reads refs only, so it stays stable. */
    const sendDoc = useCallback(() => {
        const frame = frameRef.current;
        const html = docRef.current;
        if (!frame?.contentWindow || !html) return;
        // The shell is sandboxed into an opaque origin, so "*" is the only
        // target origin that can reach it.
        frame.contentWindow.postMessage({ type: "sandbox:doc", doc: html }, "*");
    }, []);

    // A layout effect, so the listener is in place before the browser gets a
    // chance to paint, and therefore before any document we hand the frame can
    // finish booting. A missed first message reads as a piece that never ran.
    useLayoutEffect(() => {
        function onMessage(event: MessageEvent) {
            const frame = frameRef.current;
            if (!frame || event.source !== frame.contentWindow) return;
            const msg = event.data as FrameMessage | { type: "sandbox:ready" };
            if (!msg || typeof msg !== "object" || !("type" in msg)) return;

            // The shell has booted and is waiting for something to run.
            if (msg.type === "sandbox:ready") {
                sendDoc();
                return;
            }

            switch (msg.type) {
                case "alea:violation":
                    violationsRef.current = [...violationsRef.current, msg.violation];
                    break;
                case "alea:error":
                    errorsRef.current = [...errorsRef.current, msg.message];
                    onErrorRef.current?.(msg.message);
                    break;
                case "alea:params-declared":
                    onParamsDeclaredRef.current?.(msg.params);
                    break;
                case "alea:ready":
                    onResultRef.current?.({
                        seed: msg.seed,
                        digest: msg.digest,
                        image: msg.image,
                        source: msg.source,
                        features: msg.features,
                        // The frame's list is authoritative; ours catches anything
                        // that arrived before this listener attached.
                        violations: msg.violations.length >= violationsRef.current.length ? msg.violations : violationsRef.current,
                        mathRandomCalls: msg.mathRandomCalls ?? 0,
                        elapsed: msg.elapsed,
                        autoCaptured: msg.autoCaptured,
                        errors: errorsRef.current,
                    });
                    break;
                default:
                    break;
            }
        }
        window.addEventListener("message", onMessage);
        return () => window.removeEventListener("message", onMessage);
    }, [sendDoc]);

    if (!doc) return null;

    return (
        <iframe
            key={run}
            ref={frameRef}
            src={SHELL_URL}
            title={title}
            sandbox="allow-scripts"
            // Belt and braces: the shell announces itself, and we also push on
            // load. Whichever lands first wins; the shell writes only once.
            onLoad={sendDoc}
            style={{
                border: "none",
                display: "block",
                background: "#000",
                width: "100%",
                height: "100%",
                ...style,
            }}
        />
    );
}
