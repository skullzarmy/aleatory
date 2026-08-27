import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { WalletTabs } from "@/components/account/WalletTabs";
import { ProfileCard } from "@/components/account/ProfileCard";
import { ProfileNudge } from "@/components/account/ProfileNudge";
import { fetchWallet } from "@/lib/feed";
import { isAddress } from "@/lib/tzkt";
import { shortAddress } from "@/lib/utils";
import { resolveName, fetchProfile, avatarUrl, sourceFor } from "@/lib/identity";
import { convertIpfsToGatewayUrl } from "@/utils/ipfs";
import { LiveRefresh } from "@/components/LiveRefresh";

export const revalidate = 60;

export async function generateMetadata({
    params,
}: {
    params: Promise<{ address: string }>;
}): Promise<Metadata> {
    const { address } = await params;
    const [name, profile] = await Promise.all([
        resolveName(address),
        fetchProfile(address),
    ]);
    const title = profile?.name || name || shortAddress(address);
    const picture = avatarUrl(profile);
    const image = picture?.startsWith("ipfs://")
        ? convertIpfsToGatewayUrl(picture)
        : picture;

    return {
        title,
        description: profile?.bio,
        openGraph: {
            title,
            description: profile?.bio,
            images: image ? [{ url: image }] : undefined,
        },
    };
}

/**
 * One person: what they made, what they hold, and who they are.
 *
 * Keyed by an address and needing no account, no connection and no permission,
 * so a collector can send someone the link to what they hold and an artist has
 * a page from the moment they deploy rather than when they get round to filling
 * one in. It answers both questions about one address because on this chain
 * they are usually the same person.
 *
 * The profile on top is theirs from elsewhere: a hack.tez record they own and
 * edit, or an objkt profile if that is all there is. Nothing about a person is
 * stored here, which is why this page exists for people who have never used the
 * site.
 */
export default async function WalletPage({
    params,
}: {
    params: Promise<{ address: string }>;
}) {
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
