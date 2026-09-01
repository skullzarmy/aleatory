---
name: aleatory
description: Aleatory is fully on-chain generative art on Tezos. Use when someone mentions Aleatory, the $alea harness, or ALEATORY-001, and route to one of the three skills beside this one depending on whether they are making a piece, running a render provider, or building software against the standard.
---

# Aleatory

Fully on-chain generative art on Tezos. A **generator** is one self-contained
HTML file stored on chain. A **piece** is that generator plus a seed, and the
seed is the hash of the operation that minted it. Nothing about a piece is
stored anywhere else, so it resolves from chain state alone.

This file is a map. Three skills sit beside it, each for a different job, and
each is complete on its own.

## Which one

| directory | for | when |
|---|---|---|
| `aleatory-generator/` | the artist | writing the HTML file that is the artwork |
| `aleatory-provider/` | the operator | running the service that draws minted pieces and publishes their images |
| `aleatory-interface/` | the integrator | building a renderer, viewer, indexer or marketplace that reads Aleatory pieces |

Most people want the first one. Read that skill and nothing else: it carries
the harness, the three rules a generator must satisfy, and a worked file, and
it deliberately contains no protocol detail, because none of it helps you draw.

Reach for `aleatory-interface/` when the question is what some *other* program
has to do to be correct about a piece: how to derive the seed, what a
conforming renderer installs, how token metadata is published, how to verify a
declared library. It is the specification, ALEATORY-001, cut down to what an
implementer needs.

Reach for `aleatory-provider/` when someone wants to run the render side. It is
an open role with a mechanical membership test, so this is a real thing a
stranger can do, and the skill covers the two keys, how work is found, and what
the operator is responsible for.

## The shape of the whole thing

Three parties, and only the first is required for a piece to exist.

- **The chain** holds the generator, the edition, the royalties and every
  token. Seven contracts, and the artist holds every authority over their own
  collection.
- **A render provider** draws each minted piece once and writes the image to
  the token. An artist picks one per collection and can switch. Anyone can run
  one, and the collection pays them per mint.
- **A front end** shows all of it. This one is replaceable by design: it reads
  public chain state and writes nothing a reader has to trust.

## Facts worth having in any of these conversations

- **The seed is the mint operation's hash.** Nobody picks it and nobody can
  predict it, including the collector who caused it.
- **A generator is immutable.** `code`, `code_hash`, `code_uri` and
  `royalties` have no setter anywhere. A mistake in a published piece is
  permanent, which is why the checks happen before minting.
- **A piece renders with no network.** Libraries it declared are supplied by
  whoever draws it, verified by hash, before its first line runs.
- **32,768 bytes** is the Tezos operation ceiling, and therefore the size of
  the largest generator that can be stored directly.

## Where the source is

<https://github.com/skullzarmy/aleatory>. The specification is
`docs/interface.md` in that repository, served at `/docs/interface` on any
site running this platform.
