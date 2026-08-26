import { Avatar } from "./Avatar";
import { avatarUrl, SOURCE_LABEL, type Profile, type Source } from "@/lib/identity";
import { shortAddress } from "@/lib/utils";
import { tzktLink } from "@/lib/config";

/**
 * Who someone is, at the top of their page.
 *
 * Everything here is optional and the block collapses to whatever exists, down
 * to a name and an address. A page that reserves space for a bio nobody wrote
 * is a page with a hole in it.
 *
 * The chain explorer link lives here and nowhere else. This is the one place a
 * reader is looking at an address as an address.
 */
export function ProfileCard({
    address,
    name,
    profile,
    source,
}: {
    address: string;
    /** The resolved domain name, which is not the same as a chosen display name. */
    name: string | null;
    profile: Profile | null;
    /** Who supplied what is shown. Credited, and it says where to change it. */
    source?: Source | null;
}) {
    const heading = profile?.name || name || shortAddress(address);
    // Show the domain underneath only when it is not already the heading.
    const subtitle = name && name !== heading ? name : null;

    return (
        <header className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <Avatar address={address} size={72} src={avatarUrl(profile)} />

            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <h1 className="text-xl font-semibold tracking-tight">{heading}</h1>
                    {subtitle && (
                        <span className="text-sm text-muted-foreground">{subtitle}</span>
                    )}
                    {profile?.status && (
                        <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
                            {profile.status.replace(/-/g, " ")}
                        </span>
                    )}
                </div>

                {profile?.bio && (
                    <p className="mt-2 max-w-prose text-sm text-muted-foreground">
                        {profile.bio}
                    </p>
                )}

                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {/* In full. The heading is already a truncation when there
                        is no name, and two different abbreviations of one
                        address stacked reads as two addresses. */}
                    <a
                        href={tzktLink(address)}
                        target="_blank"
                        rel="noreferrer"
                        className="break-all font-mono hover:text-foreground hover:underline"
                    >
                        {address}
                    </a>
                    {profile?.location && <span>{profile.location}</span>}
                </div>

                {profile && profile.links.length > 0 && (
                    <ul className="mt-3 flex flex-wrap gap-2">
                        {profile.links.map((l) => (
                            <li key={l.kind}>
                                {l.href ? (
                                    <a
                                        href={l.href}
                                        target="_blank"
                                        rel="noreferrer me"
                                        className="inline-block rounded-md border border-border px-2 py-1 text-xs hover:bg-accent"
                                    >
                                        {l.label}
                                    </a>
                                ) : (
                                    <span className="inline-block rounded-md border border-border px-2 py-1 text-xs text-muted-foreground">
                                        {l.label}
                                    </span>
                                )}
                            </li>
                        ))}
                    </ul>
                )}

                {profile?.skills && profile.skills.length > 0 && (
                    <p className="mt-2 text-xs text-muted-foreground">
                        {profile.skills.join(" · ")}
                    </p>
                )}

                {source && (
                    <p className="mt-3 text-xs text-muted-foreground">
                        {profile ? "Profile" : "Name"} from{" "}
                        <a
                            href={SOURCE_LABEL[source].href(address)}
                            target="_blank"
                            rel="noreferrer"
                            className="underline hover:text-foreground"
                        >
                            {SOURCE_LABEL[source].name}
                        </a>
                    </p>
                )}
            </div>
        </header>
    );
}
