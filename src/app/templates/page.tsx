import type { Metadata } from "next";
import { Fragment } from "react";
import Link from "next/link";
import { RUNTIME_KINDS } from "@/lib/runtimes";
import { KitBuilder } from "@/components/templates/KitBuilder";
import { BRAND } from "@/lib/config";

export const metadata: Metadata = {
    alternates: { canonical: "/templates" },
    title: "Starter kits",
    description:
        "Pick a kit, run it with one command, publish the same file. Four need no build step; the fifth bundles any package on npm into it.",
    openGraph: { type: "website", title: "Starter kits" },
};

/** Permanent, and not tied to a tag: the kit is the current starting point. */
const RELEASE = `${BRAND.repo}/releases/latest/download`;

/**
 * How each kit is offered, keyed by kind.
 *
 * `want` is the reader's half of the sentence, so the list reads down the left
 * as a question about their own work rather than across as a catalogue of ours.
 */
const COPY: Record<string, { want: string; note: string; tag: string }> = {
    vanilla: {
        want: "draw to a canvas myself",
        note: "The smallest thing that can be a piece, and the cheapest to publish.",
        tag: "No dependencies",
    },
    p5: {
        want: "write a p5 sketch",
        note: "p5 is loaded for you and costs none of your generator's size, so your bytes go to your art.",
        tag: "Declares p5 1.5.0",
    },
    svg: {
        want: "make vector work that stays vector",
        note: "Builds an <svg> in the document, so the output stays resolution independent.",
        tag: "No dependencies",
    },
    custom: {
        want: "bring my own engine",
        note: "You implement the lifecycle: boot, render, and a call saying when the drawing is finished.",
        tag: "Declares what you name",
    },
};

/**
 * Choosing order, which is not catalog order: `RUNTIME_KINDS` is append-only
 * and ordered by when a kind was added, a fact about us rather than about the
 * work somebody is starting.
 */
const ORDER = ["vanilla", "p5", "svg", "custom"];
const at = (name: string) => (ORDER.indexOf(name) + 1 || ORDER.length + 1) - 1;

/**
 * Built from the catalog, so a kind added later appears here rather than
 * quietly not being offered. One without copy falls back to its own blurb.
 */
const KITS = [...RUNTIME_KINDS]
    .sort((a, b) => at(a.name) - at(b.name))
    .map((k) => ({
        name: k.name,
        label: k.label,
        ...(COPY[k.name] ?? { want: k.label.toLowerCase(), note: k.blurb, tag: "" }),
    }));

const STEPS = [
    { href: "#pick", n: "1", label: "Pick a kit" },
    { href: "#run", n: "2", label: "Run it locally" },
    { href: "#publish", n: "3", label: "Publish it" },
];

function H({ id, children }: { id?: string; children: React.ReactNode }) {
    return (
        <h2 id={id} className="mt-14 scroll-mt-24 text-lg font-semibold tracking-tight">
            {children}
        </h2>
    );
}

function P({ children }: { children: React.ReactNode }) {
    return <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{children}</p>;
}

/**
 * A block of commands, meant to be copied.
 *
 * `leading-relaxed` because these are read a line at a time and the default
 * sets them too close for that.
 */
function Code({ children }: { children: React.ReactNode }) {
    return (
        <pre className="mt-3 overflow-x-auto rounded-md border border-border bg-muted/40 px-3 py-2.5 text-xs leading-relaxed">
            <code>{children}</code>
        </pre>
    );
}

/**
 * A reference table: a thing you can write, and what it does.
 *
 * `max-content` sizes the left column to the longest name; the right takes
 * everything left over, so it uses the width instead of trailing off.
 */
function Reference({ rows }: { rows: [string, string][] }) {
    return (
        <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 overflow-x-auto rounded-md border border-border bg-muted/40 px-3 py-2.5 text-xs">
            {rows.map(([name, means]) => (
                <Fragment key={name}>
                    <dt className="font-mono">{name}</dt>
                    <dd className="text-muted-foreground">{means}</dd>
                </Fragment>
            ))}
        </dl>
    );
}

function Download({ file, children }: { file: string; children: React.ReactNode }) {
    return (
        <a
            href={`${RELEASE}/${file}`}
            className="shrink-0 rounded-md border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent"
        >
            {children}
        </a>
    );
}

/**
 * The starting point for working outside the studio.
 *
 * Ordered as the job is done: choose, run, publish. The downloads lead, because
 * they are what almost everybody came for, and the kit builder sits under
 * libraries where the need for it arises. A page that opens with the tool for
 * the rarest case spends its best position on the fewest readers.
 */
export default function TemplatesPage() {
    return (
        <div className="mx-auto max-w-2xl px-4 py-12">
            <h1 className="text-2xl font-semibold tracking-tight">Starter kits</h1>
            <P>
                A working generator, a local server, and a readme. Download one, run it, edit it,
                publish it. Node 18 or newer is the only requirement.
            </P>

            {/* The three steps, and the page's contents, as one thing. Somebody
                who reads it learns the shape of the job; somebody who does not
                still gets a way to jump. */}
            <nav aria-label="On this page" className="mt-6 flex flex-wrap gap-2">
                {STEPS.map((s) => (
                    <a
                        key={s.href}
                        href={s.href}
                        className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm transition-colors hover:bg-accent"
                    >
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-xs tabular-nums text-muted-foreground">
                            {s.n}
                        </span>
                        {s.label}
                    </a>
                ))}
            </nav>

            <H id="pick">Pick a kit</H>
            <P>Read down the left until one of them is what you are doing.</P>

            <ul className="mt-4 divide-y divide-border rounded-lg border border-border">
                {KITS.map((kit) => (
                    <li key={kit.name} className="p-4">
                        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
                            <h3 className="text-sm">
                                <span className="text-muted-foreground">I want to </span>
                                <span className="font-medium text-foreground">{kit.want}</span>
                            </h3>
                            <Download file={`${kit.name}.zip`}>{kit.name}.zip</Download>
                        </div>
                        <p className="mt-2 text-sm text-muted-foreground">{kit.note}</p>
                        <p className="mt-2 text-xs text-muted-foreground">
                            {kit.label} · {kit.tag}
                        </p>
                    </li>
                ))}

                {/* The fifth route is a decision rather than a download, so it
                    points at the section that makes it instead of pretending
                    to be another zip. */}
                <li className="p-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
                        <h3 className="text-sm">
                            <span className="text-muted-foreground">I want to </span>
                            <span className="font-medium text-foreground">
                                use packages from npm
                            </span>
                        </h3>
                        <a
                            href="#libraries"
                            className="shrink-0 rounded-md bg-alea-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-alea-700"
                        >
                            Start here
                        </a>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">
                        Two ways, and which one depends on the package. Build a kit with it
                        declared, or bundle it into your file.
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">Libraries, below</p>
                </li>
            </ul>

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

            <H id="run">Run it locally</H>
            <Code>{`unzip p5.zip && cd p5
node serve.mjs`}</Code>
            <P>
                Then open <code className="font-mono">http://localhost:4321</code>. Reload for a new
                seed. Edit <code className="font-mono">index.html</code> and reload again. That is
                the whole cycle: no build, no watcher, no bundler.
            </P>
            <Reference
                rows={[
                    ["?seed=<hex>", "draw one particular piece, every time"],
                    ["?p.<name>=<value>", "set a declared parameter, e.g. ?p.density=220"],
                ]}
            />

            <h3 className="mt-8 text-sm font-medium">What is in the zip</h3>
            <Reference
                rows={[
                    ["index.html", "the piece, and the only file that gets published"],
                    ["serve.mjs", "the local preview, which loads the libraries you declare"],
                    ["README.md", "the same instructions, for when this page is not open"],
                    [".devcontainer/", "a ready environment, for editors that read one"],
                ]}
            />

            <h3 className="mt-8 text-sm font-medium">Without installing Node</h3>
            <P>
                Every kit carries a{" "}
                <a
                    href="https://containers.dev"
                    target="_blank"
                    rel="noreferrer"
                    className="underline hover:text-foreground"
                >
                    dev container
                </a>
                , which is an open specification rather than one host&apos;s format. Wherever you
                open it you get Node, port 4321 forwarded, and the preview already running.
            </P>
            <Reference
                rows={[
                    ["VS Code", "open the folder, then Reopen in Container"],
                    [
                        "Codespaces, Gitpod",
                        "push the kit to a repository of your own, open it there",
                    ],
                    ["github.dev", "edits the files, but has no terminal, so nothing runs"],
                ]}
            />
            <P>
                The four simple kits need none of that to be looked at:{" "}
                <code className="font-mono">index.html</code> draws when you open it from disk, with
                a random seed each time. The local server exists to load the libraries you declare,
                and the bundler kit needs it to build.
            </P>

            <H id="rules">Three things have to be true</H>
            <P>
                All mechanical. Nothing about technique, medium, or how you wrote it. Each one is
                found after minting if it is wrong, when the piece can no longer be changed.
            </P>
            <ol className="mt-4 space-y-3 rounded-lg border border-border p-4 text-sm text-muted-foreground">
                <li>
                    <strong className="text-foreground">1. Self-contained.</strong> Nothing fetched
                    while rendering. A piece is refused the network, so one that tries is captured
                    as a blank frame. Never write a script tag pointing at a CDN. Declared libraries
                    do not count: the renderer supplies them before your code runs.
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

            <H id="libraries">Libraries</H>
            <P>
                A piece asks for a library with a meta tag, and something else supplies it: the
                local server while you work, a renderer once you publish, reading the record from
                the chain and verifying it.
            </P>
            <Code>{`<meta name="alea:library" content="p5@1.5.0">`}</Code>
            <P>
                Any package on npm can be declared that way. What it has to be is loadable from a
                plain script tag, and most modern releases are not: they ship as ES modules or
                CommonJS. That decides which of the two routes below you take.{" "}
                <Link href="/docs/libraries" className="underline hover:text-foreground">
                    Libraries
                </Link>{" "}
                covers what happens at each stage, and why the record is a hash rather than a URL.
            </P>

            <h3 className="mt-8 text-sm font-medium">If it loads from a script tag: build a kit</h3>
            <P>
                Declared libraries cost your generator none of its size. Search for what you want
                and each one is checked before you download anything, including finding an older
                version when the newest will not load.
            </P>
            <div className="mt-4">
                <KitBuilder />
            </div>

            <h3 className="mt-10 text-sm font-medium">If it does not: the bundler kit</h3>
            <section id="bundler" className="mt-3 scroll-mt-24 rounded-lg border border-border p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
                    <h4 className="text-sm font-medium">Bundler</h4>
                    <Download file="bundler.zip">bundler.zip</Download>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                    You import the package, esbuild writes it into your file, and the parts you did
                    not use are dropped. Most things are small once bundled.
                </p>
                <div className="mt-3">
                    <Reference
                        rows={[
                            ["simplex-noise", "709 bytes"],
                            ["@tweenjs/tween.js", "3.7 kB"],
                            ["d3-scale + d3-shape", "10 kB, against 279 kB to declare all of d3"],
                            [
                                "three",
                                "132 kB, and does not shrink. Declare three@0.160.1 instead.",
                            ],
                        ]}
                    />
                </div>
                <p className="mt-3 text-sm text-muted-foreground">
                    Every build prints its size against what one operation can carry, so you know
                    whether the piece is still going on chain.
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                    Needs an install and a build step. The other four need neither.
                </p>
            </section>

            <H id="publish">Publish it</H>
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
