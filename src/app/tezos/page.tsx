import type { Metadata } from "next";
import Link from "next/link";
import { BRAND } from "@/lib/config";

export const metadata: Metadata = {
    alternates: { canonical: "/tezos" },
    title: "New to Tezos",
    description:
        "What a wallet is, what it costs, and why this runs on Tezos. Written for people who collect art and have never touched a blockchain.",
    openGraph: { type: "website", title: "New to Tezos" },
};

/**
 * For the visitor who likes the work and has never held a wallet.
 *
 * Written for someone who collects prints, so it answers what they would
 * actually ask, in that order: is this the wasteful kind, what do I install,
 * what does it cost, what do I own. The energy question comes first because
 * for this reader it is not one objection among several, it is the one that
 * decides whether they read the rest.
 *
 * No price predictions and no talk of appreciation anywhere on this page. It
 * is here to get somebody to a first piece they like, not to a position.
 */
export default function TezosPage() {
    return (
        <div className="mx-auto max-w-2xl px-4 py-12">
            <h1 className="text-2xl font-semibold tracking-tight">New to Tezos</h1>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground">
                You do not need to care about blockchains to collect from here. You do need a wallet
                and a few coins, which takes about ten minutes once. This page is the short version.
            </p>

            <Section title="The energy question">
                <p>
                    Ask it first. The answer is that Tezos has never used proof of work, the mining
                    process that made Bitcoin notorious. It settles by proof of stake, which does
                    not race machines against each other and consumes a very small fraction of the
                    energy per transaction.
                </p>
                <p>
                    Minting a piece here is closer in energy terms to sending an email than to
                    anything you have read about Bitcoin. If that objection was what kept you out,
                    it does not apply to this chain.
                </p>
            </Section>

            <Section title="What a wallet actually is">
                <p>
                    Not an account. Nobody issues it, nobody can freeze it, and there is no password
                    to reset. It is a key you hold, and the chain recognises anything signed with
                    it.
                </p>
                <p>
                    That cuts both ways. No company can lock you out, and no company can let you
                    back in. Write your recovery phrase on paper, keep it somewhere you would keep a
                    passport, and never type it into anything. Anyone who has it has everything in
                    the wallet, permanently.
                </p>
                <p>
                    Nobody legitimate will ever ask you for that phrase. Not us, not support, not an
                    artist, not a moderator in a chat. Every single person who asks is stealing from
                    you.
                </p>
            </Section>

            <Section title="Getting set up">
                <p>
                    Install a Tezos wallet. Temple is a browser extension and the usual starting
                    point; Kukai runs in a browser too; Umami is a desktop app. Any of them works
                    here.
                </p>
                <p>
                    Then get some tez, the coin Tezos runs on. Most people buy it on an exchange and
                    send it to their own wallet, and some wallets sell it to you directly. A small
                    amount goes a long way: pieces here are usually priced in single-digit tez, and
                    network fees are fractions of a cent.
                </p>
                <p>
                    Come back, press connect, and approve. We see your wallet address, which is
                    public anyway, and nothing else.
                </p>
            </Section>

            <Section title="What you actually own">
                <p>
                    A record on a public ledger saying this piece is yours, which anybody can verify
                    and nobody can quietly edit. Not a licence held in our database that ends when
                    we do.
                </p>
                <p>
                    For work from this platform the code that draws your piece is stored on the
                    chain alongside it, so the artwork does not depend on a file surviving on
                    somebody&rsquo;s server. You can sell it, keep it, or hold it and never open
                    this site again.
                </p>
                <p>
                    Owning the piece is not owning the copyright, in the same way that owning a
                    print is not owning the right to reproduce it. Artists set their own terms
                    beyond that.
                </p>
            </Section>

            <Section title="Why this chain">
                <p>
                    Fees low enough that publishing a whole generator costs less than a coffee,
                    which matters when the alternative prices artists out. Storage cheap enough to
                    keep the artwork itself on the chain rather than a link to it. And a long,
                    stubborn generative art community that was here well before we were.
                </p>
            </Section>

            <div className="mt-12 flex flex-wrap gap-3 border-t border-border pt-8">
                <Link
                    href="/"
                    className="rounded-md bg-alea-600 px-4 py-2 text-sm font-medium text-white hover:bg-alea-700"
                >
                    Look at the work
                </Link>
                <Link
                    href="/about"
                    className="rounded-md border border-border px-4 py-2 text-sm hover:bg-accent"
                >
                    How {BRAND.name} works
                </Link>
            </div>
        </div>
    );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <section className="mt-10">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {title}
            </h2>
            <div className="mt-3 space-y-3 text-sm leading-relaxed [&>p]:text-muted-foreground">
                {children}
            </div>
        </section>
    );
}
