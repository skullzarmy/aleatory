"use client";

import { useEffect, useState } from "react";
import { Check, Link2, Share2 } from "lucide-react";

/**
 * Share a piece.
 *
 * The networks and the copy-link row follow rejkt.xyz's share popout, which
 * has had these four in front of Tezos collectors for a while. Hand-rolled
 * rather than lifted, because the original is built on radix's popover and
 * toast and react-icons, and this is one component.
 *
 * The URL is the piece's permanent page rather than the page a collector lands
 * on after minting, because a link that celebrates a purchase is only
 * interesting to the person who made it.
 *
 * The text is composed here rather than left to the network's preview scrape,
 * since a card pulled from a page whose image is still being rendered would
 * show nothing at all.
 */
export function ShareButtons({
    url,
    text,
    className,
}: {
    url: string;
    text: string;
    className?: string;
}) {
    const [copied, setCopied] = useState(false);
    // Offered only where it exists. Rendered from an effect rather than during
    // render, because the server has no navigator and guessing produces a
    // button that appears and vanishes on hydration.
    const [canShare, setCanShare] = useState(false);
    useEffect(() => {
        setCanShare(typeof navigator !== "undefined" && typeof navigator.share === "function");
    }, []);

    const u = encodeURIComponent(url);
    const t = encodeURIComponent(text);
    const both = encodeURIComponent(`${text} ${url}`);

    const networks = [
        { name: "X", href: `https://x.com/intent/post?text=${t}&url=${u}`, icon: <XMark /> },
        {
            name: "Bluesky",
            href: `https://bsky.app/intent/compose?text=${both}`,
            icon: <Butterfly />,
        },
        {
            name: "Farcaster",
            href: `https://farcaster.xyz/~/compose?text=${t}&embeds[]=${u}`,
            icon: <Arch />,
        },
        { name: "Telegram", href: `https://t.me/share/url?url=${u}&text=${t}`, icon: <Paper /> },
    ];

    /**
     * The platform's own sheet, which knows the apps this person actually has.
     * A cancelled share throws, and a cancelled share is not a failure.
     */
    async function share() {
        try {
            await navigator.share({ text, url });
        } catch {
            /* dismissed, or refused */
        }
    }

    async function copy() {
        try {
            await navigator.clipboard.writeText(`${text}\n${url}`);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1600);
        } catch {
            /* clipboard blocked; the links still work */
        }
    }

    return (
        <div className={className ?? "space-y-2"}>
            <div className="flex flex-wrap gap-2">
                {networks.map((n) => (
                    <a
                        key={n.name}
                        href={n.href}
                        target="_blank"
                        rel="noreferrer"
                        title={`Share on ${n.name}`}
                        className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent"
                    >
                        {n.icon}
                        <span className="sr-only">Share on {n.name}</span>
                        <span aria-hidden>{n.name}</span>
                    </a>
                ))}
            </div>
            {canShare && (
                <button
                    type="button"
                    onClick={() => void share()}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-alea-600 px-3 py-2 text-sm font-medium text-white hover:bg-alea-700"
                >
                    <Share2 size={14} aria-hidden />
                    Share
                </button>
            )}
            <button
                type="button"
                onClick={() => void copy()}
                className="inline-flex w-full items-center gap-2 rounded-md border border-border px-3 py-1.5 text-left text-xs hover:bg-accent"
            >
                {copied ? (
                    <Check size={14} className="shrink-0" aria-hidden />
                ) : (
                    <Link2 size={14} className="shrink-0" aria-hidden />
                )}
                <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground">
                    {url.replace(/^https?:\/\//, "")}
                </span>
                <span className="shrink-0 text-muted-foreground">{copied ? "Copied" : "Copy"}</span>
            </button>
        </div>
    );
}

function XMark() {
    return (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M18.9 1.2h3.7l-8.1 9.2 9.5 12.5h-7.4l-5.8-7.6-6.7 7.6H.4l8.6-9.8L0 1.2h7.6l5.2 6.9zm-1.3 19.5h2L6.5 3.2H4.3z" />
        </svg>
    );
}

function Butterfly() {
    return (
        <svg width="14" height="14" viewBox="0 0 568 501" fill="currentColor" aria-hidden>
            <path d="M123 34c65 49 135 148 161 202 26-54 96-153 161-202 47-35 123-62 123 25 0 17-10 146-16 167-20 74-95 93-162 81 117 20 147 86 83 152-122 125-175-31-189-71-2-5-4-7-4-5s-2 0-4 5c-14 40-67 196-189 71-64-66-34-132 83-152-67 12-142-7-162-81C2 205-8 76-8 59c0-87 76-60 123-25z" />
        </svg>
    );
}

function Arch() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M4 2h16v3h-3.2v14H20v1H14v-1h1.6v-6.4a3.6 3.6 0 0 0-7.2 0V19H10v1H4v-1h3.2V5H4V2z" />
        </svg>
    );
}

function Paper() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M22.1 2.6 1.4 10.5c-.9.3-.9 1.6 0 1.9l5.2 1.7 2 6.2c.3.8 1.3 1 1.9.4l2.8-2.7 5.3 3.9c.7.5 1.7.1 1.9-.7l3-16.9c.2-1-.7-1.8-1.4-1.7zM8.4 14.3l9.9-6.1c.3-.2.6.2.4.4l-8.1 7.3c-.3.3-.5.7-.5 1.1l-.1 1.9c0 .2-.3.2-.4 0l-1.2-4.6z" />
        </svg>
    );
}
