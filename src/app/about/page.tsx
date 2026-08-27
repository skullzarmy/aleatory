import type { Metadata } from "next";
import Link from "next/link";
import { BRAND } from "@/lib/config";

export const metadata: Metadata = {
    alternates: { canonical: "/about" },
    openGraph: { type: "website", title: "About" },
    title: "About",
    description: BRAND.description,
};

/**
 * The first question a visitor has.
 *
 * Answered in the order people actually ask it: what a piece is, what happens
 * when you buy one, what it costs, and what happens to all of it if this site
 * goes away.
 */
export default function AboutPage() {
    return (
        <div className="mx-auto max-w-2xl px-4 py-12">
            <h1 className="text-2xl font-semibold tracking-tight">
                Generative art that lives on the chain
            </h1>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground">
                A generator is code, published once and never changed. A piece is that code
                plus a seed, and the seed comes from the moment somebody chose to buy it.
                Nobody picks it: not the artist, not us.
            </p>

            <Section title="What you get when you buy">
                <p>
                    One signature, and the piece is yours straight away. You own it before
                    the image exists.
                </p>
                <p>
                    A render provider then draws it and publishes the image. Until that
                    lands, your piece runs live in your browser. That is the artwork, not a
                    stand-in for it.
                </p>
            </Section>

            <Section title="What it costs">
                <p>
                    Publishing costs a one-off storage fee, usually well under a dollar. The
                    studio prices your actual file before you commit to anything.
                </p>
                <p>
                    Minting costs the artist&rsquo;s price, plus a small fee to whoever
                    renders the image. Resales here take 2.5%, and artist royalties are paid
                    from the collection itself, so a seller cannot cut you out.
                </p>
            </Section>

            <Section title="What we control">
                <p>
                    Nothing here needs our permission. Anyone can publish a collection, run
                    a render provider, trade on the marketplace, or run this whole system
                    themselves. A collection you publish belongs to you, and we cannot
                    touch it.
                </p>
                <p>
                    What we control is this website. We show everything by default, and the
                    short list of what we hide is public, in{" "}
                    <a
                        href={`${BRAND.repo}/blob/main/src/lib/blocklist.ts`}
                        target="_blank"
                        rel="noreferrer"
                        className="underline hover:text-foreground"
                    >
                        one file
                    </a>
                    .
                </p>
            </Section>

            <Section title="If this site disappears">
                <p>
                    Your collection is a contract on Tezos and your piece is a token in it,
                    with the code stored right there alongside. Anyone can build a site that
                    reads{" "}
                    <Link href="/docs/interface" className="underline hover:text-foreground">
                        ALEATORY-001
                    </Link>{" "}
                    and shows what you made here. We wrote that spec so they can.
                </p>
            </Section>

            <div className="mt-12 flex flex-wrap gap-3 border-t border-border pt-8">
                <Link
                    href="/studio"
                    className="rounded-md bg-alea-600 px-4 py-2 text-sm font-medium text-white hover:bg-alea-700"
                >
                    Make something
                </Link>
                <Link
                    href="/"
                    className="rounded-md border border-border px-4 py-2 text-sm hover:bg-accent"
                >
                    See what people made
                </Link>
                <a
                    href={BRAND.repo}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-md border border-border px-4 py-2 text-sm hover:bg-accent"
                >
                    Read the source
                </a>
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
