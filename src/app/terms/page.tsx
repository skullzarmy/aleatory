import type { Metadata } from "next";
import Link from "next/link";
import { BRAND } from "@/lib/config";

export const metadata: Metadata = {
    alternates: { canonical: "/terms" },
    title: "Terms",
    description: `The terms for using ${BRAND.name}, and the licence on the code behind it.`,
    openGraph: { type: "website", title: "Terms" },
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
 * Terms of use, and the licence, in one document.
 *
 * Split into two pages elsewhere, which makes sense where a licence restricts
 * something. This one gives the code away outright, so an end user licence
 * agreement would be a page saying "there are no conditions" at length.
 *
 * The order is deliberate. What we are and are not comes first, because
 * almost everything downstream follows from this being an interface to public
 * contracts rather than a business holding anyone's property.
 */
export default function TermsPage() {
    return (
        <div className="mx-auto max-w-2xl px-4 py-12">
            <h1 className="text-2xl font-semibold tracking-tight">Terms</h1>
            <p className="mt-2 text-xs text-muted-foreground">Last updated {UPDATED}</p>

            <P>
                Using {BRAND.name} means accepting these terms. If you do not, the remedy is to stop
                using the site, which costs you nothing and takes nothing with it: anything you have
                published lives on Tezos and stays reachable without us.
            </P>

            <H>1. What this is</H>
            <P>
                {BRAND.name} is a website that reads and writes public smart contracts on the Tezos
                blockchain. It is not a bank, a broker, an exchange, a custodian, or a payment
                processor.
            </P>
            <P>
                We never hold your assets. We never hold your keys. We cannot move, freeze, reverse
                or recover anything on your behalf, and neither can anyone else, including us under
                a court order. Every transaction is signed by you in your own wallet and settled by
                the chain, not by this site.
            </P>

            <H>2. The code is public domain</H>
            <P>
                The software behind this site is released under{" "}
                <a
                    href="https://unlicense.org"
                    target="_blank"
                    rel="noreferrer"
                    className="underline hover:text-foreground"
                >
                    the Unlicense
                </a>
                . Copy it, change it, run your own, sell it, compete with us, remove our name from
                it. No permission, no attribution, no royalty, no notice to us. That is the whole of
                the arrangement and there is no version of it where we come after you for using it.
            </P>
            <P>
                In exchange it comes with no warranty of any kind and no support. If you run it and
                lose money, that is yours to carry. The full text ships in the{" "}
                <a
                    href={`${BRAND.repo}/blob/main/LICENSE`}
                    target="_blank"
                    rel="noreferrer"
                    className="underline hover:text-foreground"
                >
                    repository
                </a>{" "}
                and it governs the code if anything here contradicts it.
            </P>
            <P>
                This covers our code only. It says nothing about artwork published through the
                platform, which belongs to whoever made it.
            </P>

            <H>3. Who may use it</H>
            <P>
                You must be 18 or older and legally able to enter a contract. You may not use this
                site if you are subject to United States sanctions, are located in a sanctioned or
                embargoed jurisdiction, or appear on any restricted-party list. You may not use it
                to launder money, evade sanctions, or infringe anyone else&rsquo;s rights.
            </P>

            <H>4. Risk, stated plainly</H>
            <P>
                Transactions are irreversible. A mistyped price, a wrong address, or a confirmation
                you did not mean is final the moment it settles, and no part of this site can undo
                it.
            </P>
            <P>
                Smart contracts can contain defects. Ours have been audited and are open to read,
                and that reduces risk without removing it. Assume that the total loss of anything
                you commit here is possible.
            </P>
            <P>
                Digital assets fluctuate in value and can become worthless. Nothing on this site is
                investment, financial, tax or legal advice, and nothing here should be read as a
                recommendation to buy anything.
            </P>
            <P>
                Lose your wallet&rsquo;s recovery phrase and everything in it is gone permanently.
                We cannot help. Nobody can.
            </P>

            <H>5. Artwork and the people who make it</H>
            <P>
                Artists keep every right in what they publish. We claim no ownership and take no
                licence in anyone&rsquo;s work beyond displaying it on this site, which is what
                publishing it here is for.
            </P>
            <P>
                Publishing something is your representation that you have the right to. Do not
                publish work that is not yours to publish.
            </P>
            <P>
                Owning a piece means owning the token and whatever rights the artist attached to it.
                Unless an artist says otherwise, it does not transfer copyright.
            </P>
            <P>
                If something here infringes your rights, write to <Mail /> and we will remove it
                from this website. Understand the limit of that: we can stop showing it here, and we
                cannot remove it from Tezos, because nobody can.
            </P>

            <H>6. Fees</H>
            <P>
                We currently charge nothing to publish a collection and nothing to mint. When a
                piece is minted, the artist&rsquo;s price goes to the artist and the rendering fee
                goes to the render provider the artist chose. Both are paid in the same transaction
                and neither passes through us.
            </P>
            <P>
                We take 2.5% of sales made through our marketplace. That is a fee on resales, not on
                mints, and it is the only revenue we take from the platform.
            </P>
            <P>
                Separately, Tezos charges its own fees for storage and execution. Those go to the
                network and we never see them. Publishing a generator is the one that costs anything
                noticeable, and it is a one-off, usually well under a dollar.
            </P>
            <P>
                Every amount is shown before you approve anything. We may change our fee going
                forward, never retroactively: a listing or an offer settles at the fee it was
                created with, which is enforced by the contract rather than by our promise.
            </P>

            <H>7. What we can and cannot moderate</H>
            <P>
                We choose what appears on this website and may hide anything, for any reason,
                without notice. The list of what we hide is public and in{" "}
                <a
                    href={`${BRAND.repo}/blob/main/src/lib/blocklist.ts`}
                    target="_blank"
                    rel="noreferrer"
                    className="underline hover:text-foreground"
                >
                    one file
                </a>
                .
            </P>
            <P>
                Hiding something removes it from our interface and from nowhere else. The contracts
                remain, they remain callable, and any other site can display what we do not. That is
                the design, and we would not undo it if we could.
            </P>

            <H>8. No warranty</H>
            <P>
                The site is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;, without
                warranties of any kind, express or implied, including merchantability, fitness for a
                particular purpose, title, and non-infringement. We do not warrant that it will be
                available, uninterrupted, timely, or accurate.
            </P>
            <P>
                Much of what you see is read from third parties: chain indexers, IPFS gateways and
                profile services. It can be stale, wrong, or missing. Confirm anything that matters
                against the chain itself before you rely on it.
            </P>

            <H>9. Limitation of liability</H>
            <P>
                To the fullest extent the law allows, neither {BRAND.name} nor its operator is
                liable for any indirect, incidental, special, consequential, exemplary or punitive
                damages, or for lost profits, lost assets, lost data or lost opportunity, arising
                from your use of this site, on any theory of liability, even if advised such damages
                were possible.
            </P>
            <P>
                Our total liability for any claim is limited to the greater of the fees you paid us
                in the three months before the claim, or one hundred United States dollars.
            </P>
            <P>
                Some jurisdictions do not allow certain exclusions, so parts of this may not apply
                to you.
            </P>

            <H>10. Indemnity</H>
            <P>
                You agree to indemnify and hold harmless {BRAND.name} and its operator from any
                claim, loss, liability or expense, including reasonable legal fees, arising out of
                your use of the site, anything you publish through it, your breach of these terms,
                or your violation of any law or of anyone else&rsquo;s rights.
            </P>

            <H>11. Governing law and disputes</H>
            <P>
                These terms are governed by the laws of the State of California, without regard to
                its conflict-of-laws rules.
            </P>
            <P>
                Before filing anything, email <Mail /> and give us 30 days to resolve it. Most
                things end there. If they do not, any dispute is resolved by binding individual
                arbitration in California under the rules of a recognised arbitration provider,
                except that either of us may bring a claim in small claims court.
            </P>
            <P>
                Disputes are brought individually. You and we each waive any right to a jury trial
                and to participate in a class or representative action.
            </P>

            <H>12. Changes</H>
            <P>
                We may change these terms. Changes are posted here with a new date, and using the
                site afterwards accepts them. The site is open source, so the history of this page
                is public too.
            </P>

            <H>13. Contact</H>
            <P>
                <Mail />.
            </P>

            <div className="mt-12 flex flex-wrap gap-4 border-t border-border pt-6 text-sm">
                <Link
                    href="/terms/privacy"
                    className="text-muted-foreground underline hover:text-foreground"
                >
                    Privacy
                </Link>
                <Link
                    href="/tezos"
                    className="text-muted-foreground underline hover:text-foreground"
                >
                    New to Tezos
                </Link>
                <Link
                    href="/about"
                    className="text-muted-foreground underline hover:text-foreground"
                >
                    About
                </Link>
            </div>
        </div>
    );
}
