import { Logo } from "@/components/Logo";
import { BRAND } from "@/lib/config";

/** Where the socials live, in the order the footer lists them. */
const ELSEWHERE = [
    { href: BRAND.discord, label: "Discord" },
    { href: BRAND.x, label: "X" },
    { href: BRAND.bluesky, label: "Bluesky" },
    { href: BRAND.repo, label: "GitHub" },
];

export default function LandingPage() {
    return (
        <div className="mx-auto flex min-h-screen max-w-2xl flex-col px-5 py-14 sm:py-20">
            <header>
                <Logo size={72} label="" />
                <h1 className="mt-7 text-3xl font-semibold tracking-tight sm:text-4xl">
                    {BRAND.name}
                </h1>
                <p className="mt-2 text-lg text-muted-foreground">{BRAND.tagline}</p>
            </header>

            <main className="mt-12 space-y-10">
                <section className="space-y-4 text-base leading-relaxed text-muted-foreground">
                    <p>
                        A generator is code, published once and never changed. A piece is that code
                        plus a seed, and the seed comes from the moment somebody chose to mint it.
                        Nobody picks it: not the artist, not us.
                    </p>
                    <p>
                        One generator yields an edition the way one plate yields prints. The
                        difference is that no two impressions are alike, and the artist cannot know
                        what any of them look like before they exist.
                    </p>
                    <p>
                        The art lives in the contract, not behind a link to a server. Your piece
                        runs in your browser from what the chain holds, which is the artwork itself
                        and not a placeholder for it.
                    </p>
                </section>

                <section className="rounded-lg border border-border bg-card-background p-6">
                    <h2 className="text-lg font-semibold tracking-tight text-foreground">
                        Artists, before we open
                    </h2>
                    <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                        We are looking for artists to launch alongside us. The opening is a
                        coordinated one: a run of generators published together, announced together,
                        and promoted together rather than dropped into an empty room.
                    </p>
                    <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                        If that sounds like something you want to be part of, come and say so in
                        Discord. We will walk you through onboarding and plan the marketing around
                        your work with you.
                    </p>
                    <a
                        href={BRAND.discord}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-6 inline-flex items-center rounded-md bg-alea-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-alea-700"
                    >
                        Talk to us on Discord
                    </a>
                </section>
            </main>

            <footer className="mt-auto pt-14">
                <nav aria-label="Elsewhere" className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
                    {ELSEWHERE.map((l) => (
                        <a
                            key={l.href}
                            href={l.href}
                            target="_blank"
                            rel="noreferrer"
                            className="text-muted-foreground transition-colors hover:text-foreground"
                        >
                            {l.label}
                        </a>
                    ))}
                </nav>
                <p className="mt-6 text-xs text-muted-foreground">
                    Opening soon on Tezos mainnet.
                </p>
            </footer>
        </div>
    );
}
