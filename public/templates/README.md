# Templates

A starting point for each runtime kind Aleatory supports. These are the files
the studio starts you from, and they are the source: the studio imports what
`scripts/build-templates.mts` generates from this directory, so editing one
here changes what everybody gets.

| Kind | Needs | Start here if |
| --- | --- | --- |
| [`vanilla`](vanilla/index.html) | nothing | you want to draw to a canvas yourself |
| [`svg`](svg/index.html) | nothing | your work is vector, and you want it to stay vector |
| [`p5`](p5/index.html) | p5.js 1.5.0, declared | you already think in p5 |
| [`custom`](custom/index.html) | whatever you declare | you are bringing your own engine |

## Working locally

Take the starter kit for the kind you want, from the studio or from
`/templates/<kind>.zip`. It holds the generator, a readme, and a small local
server.

```
node serve.mjs
```

Then open http://localhost:4321. No install and no build step; Node 18 or
newer is the only requirement.

The server reads the `<meta name="alea:library">` tags in your file and loads
those libraries from a CDN, the way a renderer will load them from the record
on chain. So your generator never contains a script tag pointing at a CDN and
cannot be published with one by accident, which matters: a piece that fetches
anything while rendering is refused the network and captured blank.

Each file carries a small dev harness that only runs when the page is opened
outside our sandbox. It gives you the same `$alea` your piece will get on the
platform, so what you see locally is what a collector sees.

Reload for a new seed. To pin one, or to try a parameter value:

```
index.html?seed=<hex>
index.html?p.density=220
```

When you are happy, drag the file into the studio with **Open a .html**, or
paste it in. Nothing about it needs changing first.

## The rules a template already follows

A generator has to be one self-contained HTML file. It gets a seed, it draws,
and it says when it is finished so the image can be captured. That last part
is `$alea.ready()`, and forgetting it is the one mistake that produces a blank
piece: the renderer captures an empty frame because nothing told it the work
was done.

Anything a template declares in `<meta name="alea:library">` is fetched and
hash-verified before it runs. Declared libraries are not bundled into your
file, which is what keeps a p5 piece small enough to fit on chain. You can
declare `p5@1.5.0` and `three@0.160.1`; anything else has to be bundled, and
[libraries.md](../../docs/libraries.md) says why and how.

Declaring a library is explained in full in [libraries.md](../../docs/libraries.md).
The whole contract is [ALEATORY-001](../../docs/interface.md).
