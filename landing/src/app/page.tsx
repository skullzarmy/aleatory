import { Logo } from "@/components/Logo";
import { BRAND } from "@/lib/config";

const tree = (path: string) => `${BRAND.repo}/tree/main/${path}`;

/**
 * Linked at their source rather than copied here: the zips the app serves are
 * built from these directories, and a copy on this page would be a stale one
 * the day a kit changes.
 */
const KITS = [
    { name: "vanilla", want: "Draw to a canvas yourself", tag: "No dependencies" },
    { name: "p5", want: "Write a p5 sketch", tag: "Declares p5 1.5.0" },
    { name: "svg", want: "Vector work that stays vector", tag: "No dependencies" },
    { name: "custom", want: "Bring your own engine", tag: "Declares what you name" },
];

const ELSEWHERE = [
    { href: BRAND.discord, label: "Discord" },
    { href: BRAND.x, label: "X" },
    { href: BRAND.bluesky, label: "Bluesky" },
    { href: BRAND.repo, label: "GitHub" },
];

function Out({
    href,
    className,
    children,
}: {
    href: string;
    className?: string;
    children: React.ReactNode;
}) {
    return (
        <a href={href} target="_blank" rel="noreferrer" className={className}>
            {children}
        </a>
    );
}

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

            <main className="mt-12 space-y-12">
                <section>
                    <p className="text-lg leading-snug">
                        A generator is code, published once and never changed. A piece is that code
                        plus a seed.
                    </p>
                    <dl className="mt-6 space-y-3 text-sm">
                        <div className="flex gap-3">
                            <dt className="w-28 shrink-0 font-medium">The code</dt>
                            <dd className="text-muted-foreground">
                                Lives in the contract, not behind a link to a server.
                            </dd>
                        </div>
                        <div className="flex gap-3">
                            <dt className="w-28 shrink-0 font-medium">The seed</dt>
                            <dd className="text-muted-foreground">
                                Comes from the moment of the mint. Nobody picks it.
                            </dd>
                        </div>
                        <div className="flex gap-3">
                            <dt className="w-28 shrink-0 font-medium">The edition</dt>
                            <dd className="text-muted-foreground">
                                One generator, many impressions, no two alike.
                            </dd>
                        </div>
                    </dl>
                </section>

                <section>
                    <h2 className="text-lg font-semibold tracking-tight">Start from a kit</h2>
                    <p className="mt-2 text-sm text-muted-foreground">
                        One HTML file and a local server. Node 18, no install, no build step.
                    </p>
                    <ul className="mt-5 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2">
                        {KITS.map((kit) => (
                            <li key={kit.name} className="bg-card-background">
                                <Out
                                    href={tree(`public/templates/${kit.name}`)}
                                    className="block h-full p-4 transition-colors hover:bg-background"
                                >
                                    <span className="font-mono text-sm font-medium">
                                        {kit.name}
                                    </span>
                                    <span className="mt-1 block text-sm text-muted-foreground">
                                        {kit.want}
                                    </span>
                                    <span className="mt-2 block text-xs text-muted-foreground/70">
                                        {kit.tag}
                                    </span>
                                </Out>
                            </li>
                        ))}
                    </ul>
                    <p className="mt-4 text-sm text-muted-foreground">
                        Bringing a package that will not load from a script tag? The{" "}
                        <Out
                            href={tree("public/templates/bundler")}
                            className="underline underline-offset-4 hover:text-foreground"
                        >
                            bundler kit
                        </Out>{" "}
                        builds it into your file.
                    </p>
                    <p className="mt-3 text-sm text-muted-foreground">
                        <Out
                            href={tree("public/templates")}
                            className="underline underline-offset-4 hover:text-foreground"
                        >
                            How to run one
                        </Out>
                        {" · "}
                        <Out
                            href={tree("docs")}
                            className="underline underline-offset-4 hover:text-foreground"
                        >
                            Docs
                        </Out>
                        {" · "}
                        <Out
                            href={`${BRAND.repo}/blob/main/docs/interface.md`}
                            className="underline underline-offset-4 hover:text-foreground"
                        >
                            The spec
                        </Out>
                    </p>
                </section>

                <section className="rounded-lg border border-border bg-card-background p-6">
                    <h2 className="text-lg font-semibold tracking-tight">
                        Artists, before we open
                    </h2>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                        We are looking for artists to launch alongside us: a run of generators
                        published together, announced together, promoted together. Onboarding and
                        marketing planned with you.
                    </p>
                    <Out
                        href={BRAND.discord}
                        className="mt-5 inline-flex items-center rounded-md bg-alea-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-alea-700"
                    >
                        Talk to us on Discord
                    </Out>
                </section>
            </main>

            <footer className="mt-auto pt-14">
                <nav aria-label="Elsewhere" className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
                    {ELSEWHERE.map((l) => (
                        <Out
                            key={l.href}
                            href={l.href}
                            className="text-muted-foreground transition-colors hover:text-foreground"
                        >
                            {l.label}
                        </Out>
                    ))}
                </nav>
                <p className="mt-6 text-xs text-muted-foreground">Opening soon on Tezos mainnet.</p>
            </footer>
        </div>
    );
}
