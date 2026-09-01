/**
 * The service worker.
 *
 * Deliberately small. This site is a window onto chain state, and chain state
 * goes stale, so almost nothing here is worth holding on to. Caching a feed
 * would mean showing somebody a market that has moved.
 *
 * Two things earn a cache:
 *
 * An offline page, so losing the network gives an answer instead of the
 * browser's error, and so the app is installable and survives being opened
 * from a home screen with no signal.
 *
 * Pinned images, which are addressed by the hash of their own bytes and can
 * therefore never mean anything else. Once seen, a piece stays seen.
 *
 * Everything else goes to the network every time.
 */

const VERSION = "v1";
const SHELL = `aleatory-shell-${VERSION}`;
const ART = `aleatory-art-${VERSION}`;
const OFFLINE = "/offline";

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches
            .open(SHELL)
            .then((cache) =>
                cache.addAll([OFFLINE, "/favicon.svg", "/site.webmanifest"]),
            )
            .then(() => self.skipWaiting()),
    );
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches
            .keys()
            .then((keys) =>
                Promise.all(
                    keys
                        .filter((k) => k !== SHELL && k !== ART)
                        .map((k) => caches.delete(k)),
                ),
            )
            .then(() => self.clients.claim()),
    );
});

self.addEventListener("fetch", (event) => {
    const request = event.request;
    if (request.method !== "GET") return;

    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;

    // A piece, by CID. Immutable by definition, so cache first and never
    // revalidate: the bytes behind this URL cannot change.
    if (url.pathname.startsWith("/api/img/")) {
        event.respondWith(
            caches.open(ART).then(async (cache) => {
                const hit = await cache.match(request);
                if (hit) return hit;
                const res = await fetch(request);
                if (res.ok) cache.put(request, res.clone());
                return res;
            }),
        );
        return;
    }

    // A page. Always the network, because the alternative is showing somebody
    // a market that has moved. Offline is the only fallback.
    if (request.mode === "navigate") {
        event.respondWith(
            fetch(request).catch(() =>
                caches.match(OFFLINE).then((r) => r ?? Response.error()),
            ),
        );
    }
});
