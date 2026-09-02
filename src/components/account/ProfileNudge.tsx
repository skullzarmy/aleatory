"use client";

import { useWallet } from "@/context/WalletContext";
import { PROFILE_HOME, type Profile } from "@/lib/identity";

/**
 * Where the profile on this page comes from, and how to change it.
 *
 * Only the person whose page it is sees this. Telling a visitor that the artist
 * they are looking at has not filled in a form is neither their business nor
 * useful to them, and a site that nags strangers about someone else's profile
 * is a site nobody trusts with a byline.
 *
 * Two states worth saying something about: nothing at all, and something we
 * inherited from objkt that they may not know is being shown.
 */
export function ProfileNudge({ address, profile }: { address: string; profile: Profile | null }) {
    const { address: viewer } = useWallet();
    if (viewer !== address) return null;
    if (profile?.source === "hacktez") return null;

    return (
        <p className="mt-4 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            {profile
                ? "This is your objkt profile. Aleatory reads a hack.tez profile first, and that one is yours to edit."
                : "Your name, picture and links here come from a hack.tez profile."}{" "}
            <a
                href={PROFILE_HOME}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-foreground underline"
            >
                Set one up
            </a>
            . It is free, it is an on-chain record you own, and nothing here has an account to make.
        </p>
    );
}
