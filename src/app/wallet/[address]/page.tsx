import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { WalletTabs } from "@/components/account/WalletTabs";
import { ProfileCard } from "@/components/account/ProfileCard";
import { ProfileNudge } from "@/components/account/ProfileNudge";
import { fetchWallet } from "@/lib/feed";
import { isAddress } from "@/lib/tzkt";
import { shortAddress } from "@/lib/utils";
import { resolveName, fetchProfile, avatarUrl, sourceFor } from "@/lib/identity";
import { ipfsImageUrl } from "@/utils/ipfs";
import { LiveRefresh } from "@/components/LiveRefresh";

/**
 * Rendered per request. `revalidate` here made this a prerendered document, and
 * the refresh below re-fetched that same document rather than the chain.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata({
    params,
}: {
    params: Promise<{ address: string }>;
}): Promise<Metadata> {
    const { address } = await params;
    const [name, profile] = await Promise.all([resolveName(address), fetchProfile(address)]);
    const title = profile?.name || name || shortAddress(address);
    const picture = avatarUrl(profile);
    const image = picture?.startsWith("ipfs://") ? ipfsImageUrl(picture) : picture;

    return {
        title,
        description: profile?.bio,
        alternates: { canonical: `/wallet/${address}` },
        twitter: {
            card: image ? "summary_large_image" : "summary",
            title,
            description: profile?.bio,
            images: image ? [image] : undefined,
        },
        openGraph: {
            title,
            description: profile?.bio,
            images: image ? [{ url: image }] : undefined,
        },
    };
}

// Profile data is fetched from elsewhere (a hack.tez record, or an objkt profile as
// fallback); nothing about a person is stored here, so the page works for any address.
export default async function WalletPage({ params }: { params: Promise<{ address: string }> }) {
    const { address } = await params;
    if (!isAddress(address)) notFound();

    const [{ held, made, unconfigured }, name, profile, source] = await Promise.all([
        fetchWallet(address),
        resolveName(address),
        fetchProfile(address),
        sourceFor(address),
    ]);

    return (
        <div className="mx-auto max-w-7xl px-4 py-8">
            <LiveRefresh seconds={60} />
            <ProfileCard address={address} name={name} profile={profile} source={source} />
            <ProfileNudge address={address} profile={profile} />

            {unconfigured ? (
                <p className="mt-8 text-sm text-muted-foreground">
                    Nothing to show on this network yet.
                </p>
            ) : (
                <WalletTabs made={made} held={held} />
            )}
        </div>
    );
}
