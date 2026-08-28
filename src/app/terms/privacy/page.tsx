import type { Metadata } from "next";
import Link from "next/link";
import { BRAND } from "@/lib/config";

export const metadata: Metadata = {
    alternates: { canonical: "/terms/privacy" },
    title: "Privacy",
    description: `What ${BRAND.name} collects, what it never collects, and which third parties see you.`,
    openGraph: { type: "website", title: "Privacy" },
};

const UPDATED = "27 August 2026";
const CONTACT = "hello@aleatory.art";

function H({ children }: { children: React.ReactNode }) {
    return <h2 className="mt-10 text-lg font-semibold tracking-tight">{children}</h2>;
}

function P({ children }: { children: React.ReactNode }) {
    return <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{children}</p>;
}

function Mail() {
    return (
        <a href={`mailto:${CONTACT}`} className="underline hover:text-foreground">
            {CONTACT}
        </a>
    );
}

/**
 * What we collect, said plainly.
 *
 * Written against what the code actually does rather than against a template.
 * The third-party list is the CSP's `connect-src` and `img-src` read back as
 * prose: every host the browser is permitted to reach is a host that sees the
 * visitor's IP address, and a policy that omits them is inaccurate no matter
 * how carefully the rest is worded.
 */
export default function PrivacyPage() {
    return (
        <div className="mx-auto max-w-2xl px-4 py-12">
            <h1 className="text-2xl font-semibold tracking-tight">Privacy</h1>
            <p className="mt-2 text-xs text-muted-foreground">Last updated {UPDATED}</p>

            <P>
                {BRAND.name} has no accounts, no sign-up and no password. There is nothing to
                register and no profile held here. What follows is the whole of it.
            </P>

            <H>1. What we collect</H>
            <P>
                <strong className="text-foreground">Nothing you type,</strong> because there is
                nowhere to type it. No email address, no name, no payment details. Buying a
                piece is a Tezos transaction between you and a contract, so no card or bank
                detail ever reaches this site.
            </P>
            <P>
                <strong className="text-foreground">Your wallet address,</strong> when you
                connect one. It is used to show what you own, to build the transaction you
                approve, and for nothing else. We never see your private key or your seed
                phrase, and we cannot move anything without you approving it in your wallet.
            </P>
            <P>
                <strong className="text-foreground">Usage measurements,</strong> through
                Cloudflare Web Analytics: which pages are visited, roughly where from, and how
                fast they loaded. It sets no cookie, it does not fingerprint your browser, and
                it cannot follow you to another site. It is not tied to your wallet address.
            </P>
            <P>
                <strong className="text-foreground">Server logs,</strong> kept briefly by our
                host and our CDN in the ordinary course of serving a page.
            </P>

            <H>2. What stays on your own device</H>
            <P>
                Your wallet session is held in your browser&rsquo;s local storage so you are not
                asked to reconnect on every page. Disconnecting clears it.
            </P>
            <P>
                Studio drafts are held in your browser&rsquo;s IndexedDB. A draft is not uploaded
                anywhere and we cannot read it. It exists only on the device you wrote it on,
                which also means clearing that browser&rsquo;s data deletes it for good.
            </P>

            <H>3. Who else sees you</H>
            <P>
                A page here loads data from other people&rsquo;s servers, and each of them
                necessarily sees your IP address. We do not control what they log. They are:
            </P>
            <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                <li>
                    <strong className="text-foreground">TzKT,</strong> the chain indexer every
                    page reads from.
                </li>
                <li>
                    <strong className="text-foreground">objkt,</strong> for profile details when
                    an artist has no hack.tez profile.
                </li>
                <li>
                    <strong className="text-foreground">hack.tez,</strong> for names and avatars.
                </li>
                <li>
                    <strong className="text-foreground">IPFS gateways,</strong> which serve the
                    images. A piece&rsquo;s image is fetched from one of them, not from us.
                </li>
                <li>
                    <strong className="text-foreground">Your wallet&rsquo;s relay,</strong> run by
                    Trilitech or the Beacon network, which carries the connection request to
                    your wallet.
                </li>
                <li>
                    <strong className="text-foreground">Netlify and Cloudflare,</strong> which
                    host and serve the site.
                </li>
            </ul>
            <P>
                Following a link off this site, to a block explorer or a marketplace, puts you
                under their policy rather than this one.
            </P>

            <H>4. What is public forever</H>
            <P>
                This part matters more than the rest and cannot be undone by us or by you.
                Deploying a collection, minting a piece, listing, buying and making an offer are
                all Tezos transactions. They are public, permanent, and readable by anyone,
                including your wallet address and everything you chose to publish: a
                collection&rsquo;s name and description, and the generator&rsquo;s source code.
            </P>
            <P>
                There is no delete. Not by us, not by anyone. Publish accordingly.
            </P>

            <H>5. Running a piece</H>
            <P>
                Artwork runs inside a separate sandboxed origin that is forbidden from making
                any network request at all. A piece cannot call home, cannot load a tracker and
                cannot see your wallet. That restriction is enforced by the browser, not by our
                good intentions.
            </P>

            <H>6. What we never do</H>
            <P>
                We do not sell or rent anything about you, we run no advertising, and we share
                nothing with data brokers. There is no cross-site tracking here and no
                advertising cookie. We would disclose data if compelled by law, and the honest
                answer is that there is almost nothing to hand over.
            </P>

            <H>7. Your rights</H>
            <P>
                Wherever you live, you can ask what we hold about you and ask us to delete it.
                Email <Mail /> and we will answer. Two limits worth stating up front: anything
                written to the Tezos blockchain cannot be deleted by anyone, and a draft on your
                own device is yours to delete rather than ours.
            </P>

            <H>8. Children</H>
            <P>
                This site is not intended for anyone under 13, and we do not knowingly collect
                anything from them.
            </P>

            <H>9. Changes</H>
            <P>
                Changes are posted here with a new date. The site is open source, so the history
                of this page is public too.
            </P>

            <H>10. Contact</H>
            <P>
                <Mail />.
            </P>

            <div className="mt-12 border-t border-border pt-6">
                <Link
                    href="/about"
                    className="text-sm text-muted-foreground underline hover:text-foreground"
                >
                    About {BRAND.name}
                </Link>
            </div>
        </div>
    );
}
