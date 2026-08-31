# Documentation

Specifications and guides. Start with the one for what you are doing; each says
where to go next.

The repository map, and what Aleatory is for, are in the
[root README](../README.md).

## If you are making a generator

| | |
|---|---|
| [libraries.md](libraries.md) | How a generator asks for p5 or three.js instead of carrying a copy: the tag, what can be declared, what happens at each stage, and why the record is a hash rather than a URL. |
| [params.md](params.md) | Mint-time parameters. Up to five, named and ranged by the artist, resolved by a rule specified precisely enough that another platform can build a mint UI from it alone. |

Downloadable starting points, and the local loop, are in
[`public/templates/`](../public/templates/).

## If you are building against the platform

| | |
|---|---|
| [interface.md](interface.md) | **ALEATORY-001.** The interface a conforming collection implements. Normative, and written so it can be built against without this source. |
| [architecture.md](architecture.md) | How the pieces fit and why each is shaped that way. The reasoning behind the spec, including what this deliberately does not do. |

## If you are running infrastructure

| | |
|---|---|
| [provider.md](provider.md) | Running a render provider: what you earn, how artists find you, getting listed, and the four ways it stops working quietly. |
| [deploying.md](deploying.md) | Standing up an instance: contracts, the site, the daemon, and keeping it running. |
| [identity.md](identity.md) | How an address becomes a name, a face and a profile, and why we are never the authority behind any of it. |

## Directory READMEs

The code documents itself one level down.

| | |
|---|---|
| [`contract/`](../contract/) | What each contract owns, and who can change it |
| [`src/`](../src/) | The website |
| [`isolate/`](../isolate/) | The origin artwork runs in |
| [`provider/`](../provider/) | The render provider |
| [`admin/`](../admin/) | The operator console |
| [`scripts/`](../scripts/) | Operator commands and build steps |
