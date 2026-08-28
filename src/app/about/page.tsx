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
 * Opens on the word itself. The specialized sense is not a joke at the
 * reader's expense: chance-as-method is a century-old practice with Cage at
 * the front of it, and saying so places the work in a lineage rather than
 * treating randomness as a novelty the chain invented.
 *
 * Then answered in the order people actually ask: what happens when you mint,
 * what it costs, who decides, and what survives us.
 *
 * Reaches for print vocabulary where there is a choice. "Mint" stays, because
 * Art Blocks and fxhash have already taught it to everyone who makes this kind
 * of work. What goes is the wallet vocabulary underneath it: a signature is an
 * approval, a storage fee is a fee.
 */
export default function AboutPage() {
    return (
        <div className="mx-auto max-w-2xl px-4 py-12">
            <Entry />

            <p className="mt-8 text-base leading-relaxed text-muted-foreground">
                A generator is code, published once and never changed. A piece is that code
                plus a seed, and the seed comes from the moment somebody chose to mint it.
                Nobody picks it: not the artist, not us.
            </p>

            <p className="mt-4 text-base leading-relaxed text-muted-foreground">
                One generator yields an edition the way one plate yields prints. The
                difference is that no two impressions are alike, and the artist cannot know
                what any of them look like before they exist.
            </p>

            <Section title="Minting">
                <p>
                    Minting is one approval, and the piece is yours before its image exists.
                    A render provider draws it afterwards. Until that arrives your piece runs
                    live in your browser, which is the artwork itself and not a placeholder
                    for it.
                </p>
            </Section>

            <Section title="Costs">
                <p>
                    Publishing a generator costs a one-off fee, usually well under a dollar,
                    and the studio prices your actual file before you commit to anything.
                </p>
                <p>
                    Minting costs the artist&rsquo;s price plus a small fee to whoever renders
                    the image. Resales here take 2.5%. Royalties are paid by the collection
                    itself, so a seller cannot cut the artist out.
                </p>
            </Section>

            <Section title="Permission">
                <p>
                    None of it needs ours. Anyone can publish a collection, run a render
                    provider, trade, or run this whole system themselves. What you publish is
                    yours and we cannot touch it.
                </p>
                <p>
                    We control this website. Everything shows by default, and the short list
                    of what we hide is public, in{" "}
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
                    and show what you made. We wrote that spec so they can.
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

/** The name, defined. Marked up as a definition because that is what it is. */
function Entry() {
    return (
        <dl className="border-l-2 border-alea-600 pl-5">
            <dt>
                <h1 className="text-2xl font-semibold tracking-tight">aleatory</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                    <span className="italic">adjective</span>
                    <span className="mx-2 opacity-40">·</span>
                    <span className="font-mono text-xs">
                        us /ˈeɪ.li.ə.tɔːr.i/ uk /ˈeɪ.li.ə.tər.i/
                    </span>
                </p>
            </dt>

            <dd className="mt-5 space-y-4 text-sm leading-relaxed">
                <div>
                    <p>
                        <span className="mr-2 text-muted-foreground">1.</span>
                        <span className="italic text-muted-foreground">formal </span>
                        happening, done, or chosen by chance, rather than according to any
                        plan.
                    </p>
                    <p className="mt-1 pl-6 text-xs text-muted-foreground">
                        Synonym: random
                    </p>
                </div>

                <div>
                    <p>
                        <span className="mr-2 text-muted-foreground">2.</span>
                        <span className="italic text-muted-foreground">
                            music, art, literature{" "}
                        </span>
                        involving some parts that are chosen by chance, for example by a
                        computer or by a performer.
                    </p>
                    <p className="mt-1 pl-6 text-xs italic text-muted-foreground">
                        &ldquo;John Cage has been a key proponent of aleatory music.&rdquo;
                    </p>
                </div>
            </dd>
        </dl>
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
