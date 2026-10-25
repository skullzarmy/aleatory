import { parseLibraries, type LibrarySpec } from "../libraries/parser.js";
import { resolveLibraries } from "../libraries/resolver.js";
import { createSandbox, type SandboxController } from "./sandbox.js";

const BaseElement: typeof HTMLElement =
    typeof HTMLElement !== "undefined" ? HTMLElement : (class {} as unknown as typeof HTMLElement);

/**
 * Custom web component `<aleatory-viewer>` for embedding Aleatory generative art.
 */
export class AleatoryViewerElement extends BaseElement {
    static get observedAttributes() {
        return ["code", "seed", "params", "live-clock", "dpr", "cdn-url"];
    }

    public cdnUrl?: (spec: LibrarySpec) => string;

    private controller: SandboxController | null = null;
    private renderNonce = 0;

    connectedCallback() {
        this.renderPiece();
    }

    disconnectedCallback() {
        this.destroySandbox();
    }

    attributeChangedCallback() {
        if (this.isConnected) {
            this.renderPiece();
        }
    }

    private destroySandbox() {
        if (this.controller) {
            this.controller.destroy();
            this.controller = null;
        }
    }

    private async renderPiece() {
        const nonce = ++this.renderNonce;
        this.destroySandbox();

        const code = this.getAttribute("code") || "";
        const seed = this.getAttribute("seed") || "unseeded";
        const liveClockAttr = this.getAttribute("live-clock");
        const liveClock = liveClockAttr === null || liveClockAttr !== "false";
        const dprAttr = this.getAttribute("dpr");
        const maxDpr = dprAttr ? parseFloat(dprAttr) : undefined;

        let params: Record<string, unknown> = {};
        const paramsAttr = this.getAttribute("params");
        if (paramsAttr) {
            try {
                params = JSON.parse(paramsAttr);
            } catch {}
        }

        if (!code) return;

        // Automatically parse and resolve any declared <meta name="alea:library"> scripts
        const { specs } = parseLibraries(code);
        let deps: string[] = [];

        if (specs.length > 0) {
            try {
                const cdnAttr = this.getAttribute("cdn-url");
                const customCdn =
                    this.cdnUrl ||
                    (cdnAttr
                        ? (spec: LibrarySpec) =>
                              cdnAttr
                                  .replace("{id}", encodeURIComponent(spec.id))
                                  .replace("{version}", encodeURIComponent(spec.version))
                                  .replace("{path}", encodeURIComponent(spec.path || ""))
                                  .replace("{hash}", encodeURIComponent(spec.hash || ""))
                        : undefined);
                const resolved = await resolveLibraries(specs, { cdnUrl: customCdn });
                if (this.renderNonce !== nonce) return;
                deps = resolved.map((r) => r.source);
            } catch (err) {
                if (this.renderNonce !== nonce) return;
                this.dispatchEvent(
                    new CustomEvent("error", {
                        detail: { message: err instanceof Error ? err.message : String(err) },
                        bubbles: true,
                    }),
                );
                return;
            }
        }

        if (this.renderNonce !== nonce) return;

        this.controller = createSandbox(
            this,
            {
                code,
                seed,
                params,
                deps,
                liveClock,
                maxDpr,
            },
            {
                onReady: (detail) => {
                    this.dispatchEvent(new CustomEvent("ready", { detail, bubbles: true }));
                },
                onError: (detail) => {
                    this.dispatchEvent(new CustomEvent("error", { detail, bubbles: true }));
                },
                onViolation: (detail) => {
                    this.dispatchEvent(new CustomEvent("violation", { detail, bubbles: true }));
                },
            },
        );
    }
}

if (typeof customElements !== "undefined" && !customElements.get("aleatory-viewer")) {
    customElements.define("aleatory-viewer", AleatoryViewerElement);
}
