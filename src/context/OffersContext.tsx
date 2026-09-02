"use client";

import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
    type ReactNode,
} from "react";
import { useWallet } from "./WalletContext";
import {
    fetchAccountOffers,
    type AccountOffers,
    type IncomingOffer,
    type Offer,
} from "@/lib/market";

/**
 * Standing offers, for whoever is connected.
 *
 * One provider rather than a hook called in two places, because the header and
 * the offers page have to agree. Accepting an offer has to clear the count in
 * the menu at the same moment it leaves the list, and the mark that says an
 * offer has been looked at is written by the page and read by the header.
 *
 * Read state lives in `localStorage`, keyed by address. Nothing about a person
 * is stored on this site, so there is no account to hang it on and nowhere
 * else it could go. The consequence is honest: it is per browser, and the dot
 * lights again on a machine you have not used.
 *
 * Nothing here is privileged. Every offer in the big map is public, and this is
 * a view of it filtered to one address, which is why it needs no server.
 */
const POLL_SECONDS = 60;

interface OffersState {
    /** Offers on pieces this account holds or has listed, best first. */
    incoming: IncomingOffer[];
    /** Offers this account made, and the tez each one is escrowing. */
    outgoing: Offer[];
    /** How many incoming offers have not been looked at. */
    unseen: number;
    /** True on the first read for an address, not on every poll. */
    loading: boolean;
    /** Read again now. For after an operation settles. */
    refresh: () => void;
    /** Treat everything currently incoming as looked at. */
    markSeen: () => void;
}

const EMPTY: AccountOffers = { incoming: [], outgoing: [] };

/** An offer's identity. Ids restart per marketplace, so the address is part of it. */
const keyOf = (o: Offer) => `${o.marketplace}:${o.id}`;

const storageKey = (address: string) => `aleatory:offers-seen:${address}`;

function readSeen(address: string): Set<string> {
    try {
        const raw = localStorage.getItem(storageKey(address));
        const parsed: unknown = raw ? JSON.parse(raw) : null;
        if (!Array.isArray(parsed)) return new Set();
        return new Set(parsed.filter((k): k is string => typeof k === "string"));
    } catch {
        // Blocked storage, or something else's value under our key. Everything
        // reads as unseen, which is the safe way to be wrong: a dot that should
        // not be there costs a glance, one that is missing costs a sale.
        return new Set();
    }
}

function writeSeen(address: string, keys: string[]): void {
    try {
        localStorage.setItem(storageKey(address), JSON.stringify(keys));
    } catch {
        /* storage blocked; the dot stays lit */
    }
}

const OffersContext = createContext<OffersState | null>(null);

export function OffersProvider({ children }: { children: ReactNode }) {
    const { address } = useWallet();
    const [offers, setOffers] = useState<AccountOffers>(EMPTY);
    const [seen, setSeen] = useState<Set<string>>(() => new Set());
    const [loading, setLoading] = useState(false);
    const [tick, setTick] = useState(0);

    const refresh = useCallback(() => setTick((n) => n + 1), []);

    // A different wallet is a different set of offers and a different set of
    // marks. Without this, disconnecting leaves the last account's count in the
    // menu and the next one inherits its read state.
    useEffect(() => {
        setOffers(EMPTY);
        setSeen(address ? readSeen(address) : new Set());
    }, [address]);

    useEffect(() => {
        if (!address) return;
        let cancelled = false;
        // Only the first read for an address blanks the view. A poll that fails
        // or is slow should leave what is on screen alone.
        setLoading((was) => was || tick === 0);
        void fetchAccountOffers(address)
            .then((next) => {
                if (!cancelled) setOffers(next);
            })
            .catch(() => {
                /* an indexer that did not answer is not an empty offer book */
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [address, tick]);

    // Paused while the tab is hidden, and read again on coming back. Same
    // reasoning as LiveRefresh: a background tab polling an indexer to update a
    // page nobody is looking at spends somebody's battery and our rate limit,
    // and the read that matters is the one on return.
    useEffect(() => {
        if (!address) return;

        let timer: number | undefined;
        const stop = () => {
            if (timer !== undefined) window.clearInterval(timer);
            timer = undefined;
        };
        const start = () => {
            stop();
            timer = window.setInterval(refresh, POLL_SECONDS * 1000);
        };

        function onVisibility() {
            if (document.hidden) {
                stop();
            } else {
                refresh();
                start();
            }
        }

        if (!document.hidden) start();
        document.addEventListener("visibilitychange", onVisibility);
        return () => {
            stop();
            document.removeEventListener("visibilitychange", onVisibility);
        };
    }, [address, refresh]);

    // The stored set is replaced rather than added to, so it tracks the open
    // offers and cannot grow without bound as offers are accepted and cancelled.
    const markSeen = useCallback(() => {
        if (!address) return;
        const keys = offers.incoming.map(keyOf);
        writeSeen(address, keys);
        setSeen(new Set(keys));
    }, [address, offers.incoming]);

    const value = useMemo<OffersState>(() => {
        return {
            incoming: offers.incoming,
            outgoing: offers.outgoing,
            unseen: offers.incoming.filter((o) => !seen.has(keyOf(o))).length,
            loading,
            refresh,
            markSeen,
        };
    }, [offers, seen, loading, refresh, markSeen]);

    return <OffersContext.Provider value={value}>{children}</OffersContext.Provider>;
}

export function useOffers(): OffersState {
    const ctx = useContext(OffersContext);
    if (!ctx) throw new Error("useOffers must be used inside OffersProvider");
    return ctx;
}
