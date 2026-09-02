import type { Metadata } from "next";
import Link from "next/link";
import { RUNTIME_KINDS } from "@/lib/runtimes";
import { BRAND } from "@/lib/config";

export const metadata: Metadata = {
    alternates: { canonical: "/templates" },
    title: "Starter kits",
    description:
        "Download a working generator, run it locally with one command, and publish the same file. No install, no build step.",
    openGraph: { type: "website", title: "Starter kits" },
};

/** Permanent, and not tied to a tag: the kit is the current starting point. */
const RELEASE = `${BRAND.repo}/releases/latest/download`;

const KITS: Record<string, { for: string; declares: string; note: string }> = {
    vanilla: {
        for: "Drawing to a canvas yourself, with no library in the way.",
        declares: "Nothing.",
        note: "The smallest thing that can be a piece, and the cheapest to publish.",
    },
    svg: {
        for: "Vector work that should stay vector.",
        declares: "Nothing.",
        note: "Builds an <svg> in the document rather than rasterising, so the output stays resolution independent.",
    },
    p5: {
        for: "Anyone who already thinks in p5.",
        declares: "p5.js 1.5.0.",
        note: "p5 is loaded for you and costs you none of your generator's size, so your bytes go to your art.",
    },
    custom: {
        for: "Bringing your own engine, three.js or anything else.",
        declares: "Whatever you name in a meta tag.",
        note: "You implement the lifecycle: boot, render, and a call saying when the drawing is finished.",
    },
};

function H({ children }: { children: React.ReactNode }) {
    return <h2 className="mt-12 text-lg font-semibold tracking-tight">{children}</h2>;
}

function P({ children }: { children: React.ReactNode }) {
    return <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{children}</p>;
}

function Code({ children }: { children: React.ReactNode }) {
    return (
        <pre className="mt-3 overflow-x-auto rounded-md border border-border bg-muted/40 p-3 text-xs">
            <code>{children}</code>
        </pre>
    );
}

/**
 * The starting point for working outside the studio.
 *
 * This replaces a download button that changed with whatever kind happened to
 * be selected, which meant the same control produced four different files and
 * never said which. A page can say what each one is, which is the difference
 * between a download and a kit somebody can actually use.
 */
export default function TemplatesPage() {
    return (
        <div className="mx-auto max-w-2xl px-4 py-12">
            <h1 className="text-2xl font-semibold tracking-tight">Starter kits</h1>
            <P>
                A working generator, a local server, and a readme. Download one, run it, edit it,
                publish it. Node 18 or newer is the only requirement and there is nothing to
                install.
            </P>

            <H>The loop</H>
            <Code>{`unzip p5.zip && cd p5
node serve.mjs        # then open http://localhost:4321`}</Code>
            <P>
                Reload for a new seed. Edit <code className="font-mono">index.html</code> and reload
                again. That is the whole cycle: no build, no watcher, no bundler.
            </P>
            <Code>{`?seed=<hex>            draw one particular piece, every time
?p.<name>=<value>      set a declared parameter, e.g. ?p.density=220`}</Code>

            <H>What is in a kit</H>
            <dl className="mt-4 space-y-3 text-sm">
                <div>
                    <dt className="font-mono">index.html</dt>
                    <dd className="mt-1 text-muted-foreground">
                        The piece. This is the only file that gets published and the only one that
                        ends up on chain.
                    </dd>
                </div>
                <div>
                    <dt className="font-mono">serve.mjs</dt>
                    <dd className="mt-1 text-muted-foreground">
                        A local preview. It reads the libraries your file declares and loads them
                        while you work.
                    </dd>
                </div>
                <div>
                    <dt className="font-mono">README.md</dt>
                    <dd className="mt-1 text-muted-foreground">
                        The same instructions, next to the code, for when this page is not open.
                    </dd>
                </div>
            </dl>

            <H>Never write a CDN script tag</H>
            <P>
                A piece asks for a library with a meta tag, and something else supplies it: the
                local server while you work, a renderer once you publish, reading the record from
                the chain and verifying it.
            </P>
            <Code>{`<meta name="alea:library" content="p5@1.5.0">`}</Code>
            <P>
                So your generator never contains a script tag pointing at a CDN, and it should not.
                A piece is refused the network while it renders, so one that fetches is captured as
                a blank frame, and you find out after minting, when the piece can no longer be
                changed.
            </P>
            <P>
                You can declare p5 and three.js today, and anything else has to be bundled into your
                file.{" "}
                <Link href="/docs/libraries" className="underline hover:text-foreground">
                    Libraries
                </Link>{" "}
                covers what is available, what happens at each stage, and how a library gets added.
            </P>

            <H>The kits</H>
            <div className="mt-4 space-y-4">
                {RUNTIME_KINDS.map((k) => {
                    const kit = KITS[k.name];
                    if (!kit) return null;
                    return (
                        <section key={k.kindId} className="rounded-lg border border-border p-4">
                            <div className="flex flex-wrap items-baseline justify-between gap-3">
                                <h3 className="font-medium">{k.label}</h3>
                                <a
                                    href={`${RELEASE}/${k.name}.zip`}
                                    className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent"
                                >
                                    Download {k.name}.zip
                                </a>
                            </div>
                            <p className="mt-2 text-sm text-muted-foreground">{kit.for}</p>
                            <p className="mt-2 text-sm text-muted-foreground">{kit.note}</p>
                            <p className="mt-2 text-xs text-muted-foreground">
                                Declares: {kit.declares}
                            </p>
                        </section>
                    );
                })}
            </div>
            <P>
                Built from{" "}
                <a
                    href={`${BRAND.repo}/tree/main/public/templates`}
                    target="_blank"
                    rel="noreferrer"
                    className="underline hover:text-foreground"
                >
                    the templates in the repository
                </a>{" "}
                every time they change, so what you download is what is running here.
            </P>

            <H>What has to be true of your piece</H>
            <P>
                Three things, all mechanical. Nothing about technique, medium, or how you wrote it.
            </P>
            <ol className="mt-3 space-y-2 text-sm text-muted-foreground">
                <li>
                    <strong className="text-foreground">1. Self-contained.</strong> Nothing fetched
                    while rendering. Declared libraries do not count: the renderer supplies them
                    before your code runs.
                </li>
                <li>
                    <strong className="text-foreground">2. Deterministic.</strong> One seed, one
                    image. Take every random decision from <code className="font-mono">$alea</code>,
                    never from <code className="font-mono">Math.random</code> or the clock. The kit
                    replaces both locally so you cannot drift without noticing.
                </li>
                <li>
                    <strong className="text-foreground">3. Say when you are finished</strong> by
                    calling <code className="font-mono">$alea.ready()</code>. Forgetting this is the
                    one mistake that yields a blank piece. The templates bind the global to a
                    shorter name on their first line, which is why their code reads{" "}
                    <code className="font-mono">alea.ready()</code>.
                </li>
            </ol>

            <H>Coming back</H>
            <P>
                Drag your file into{" "}
                <Link href="/studio/new" className="underline hover:text-foreground">
                    the studio
                </Link>
                . It reads what your file declares and works out which kind it is, so there is
                nothing to remember and nothing to select. Change it there if the guess is wrong.
            </P>

            <div className="mt-12 flex flex-wrap gap-3 border-t border-border pt-8">
                <Link
                    href="/studio/new"
                    className="rounded-md bg-alea-600 px-4 py-2 text-sm font-medium text-white hover:bg-alea-700"
                >
                    Open the studio
                </Link>
                <Link
                    href="/docs/interface"
                    className="rounded-md border border-border px-4 py-2 text-sm hover:bg-accent"
                >
                    Read ALEATORY-001
                </Link>
            </div>
        </div>
    );
}
