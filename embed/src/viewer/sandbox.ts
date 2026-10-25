import { buildDocument } from "../core/document.js";
import type { DocumentOptions, ErrorEventPayload, ReadyEventPayload, ViolationEventPayload } from "../core/types.js";

export interface SandboxCallbacks {
    onReady?: (payload: ReadyEventPayload) => void;
    onError?: (payload: ErrorEventPayload) => void;
    onViolation?: (payload: ViolationEventPayload) => void;
}

export interface SandboxController {
    iframe: HTMLIFrameElement;
    destroy: () => void;
}

/**
 * Creates and attaches a sandboxed iframe running the assembled generator document.
 */
export function createSandbox(
    container: HTMLElement,
    options: DocumentOptions,
    callbacks: SandboxCallbacks = {},
): SandboxController {
    const doc = buildDocument(options);

    const iframe = document.createElement("iframe");
    iframe.setAttribute("sandbox", "allow-scripts allow-downloads");
    iframe.setAttribute("title", "Aleatory Piece");
    iframe.style.border = "0";
    iframe.style.width = "100%";
    iframe.style.height = "100%";
    iframe.style.display = "block";
    iframe.srcdoc = doc;

    function handleMessage(e: MessageEvent) {
        if (e.source !== iframe.contentWindow) return;
        const data = e.data;
        if (!data || typeof data !== "object") return;

        if (data.type === "alea:ready") {
            callbacks.onReady?.(data as ReadyEventPayload);
        } else if (data.type === "alea:violation") {
            callbacks.onViolation?.(data as ViolationEventPayload);
        } else if (data.type === "alea:error") {
            callbacks.onError?.(data as ErrorEventPayload);
        }
    }

    window.addEventListener("message", handleMessage);
    container.appendChild(iframe);

    return {
        iframe,
        destroy() {
            window.removeEventListener("message", handleMessage);
            if (iframe.parentNode) {
                iframe.parentNode.removeChild(iframe);
            }
        },
    };
}
