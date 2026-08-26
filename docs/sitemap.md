# Pages

**Status:** built, 2026-08-25. What each page is for, and what is left.

The site serves three people who want different things. A collector is
browsing, an artist is working, a provider is operating.

---

## The shape

Grouped by who is on the page.

### Browsing

```
/                     recent feed
/market               listings and offers
/collections          all collections
/collection/[address] one collection, and mint
/piece/[c]/[id]       one piece
/wallet/[address]     what someone holds and made
```

`/wallet/[address]` is keyed by an address and needs no account, no connection
and no permission, so a collector can send someone the link to what they hold
and an artist has a public page from the moment they deploy. It answers both
questions about one address because on this chain they are usually the same
person.

### Making

```
/studio                    the workspace, everything below lives inside it
/studio/new                load a generator: template, file, or paste
/studio/[draft]            preview, seeds, params, checks, cost
/studio/[draft]/publish    pin, deploy, one signature
/manage                    collections you own
/manage/[address]          price, pause, edition, provider, resolver trust
```

A draft lives in the browser: IndexedDB, one record per generator, exportable
as a single document. That keeps the studio usable with no account and puts
nothing of the artist's on our infrastructure, and it means a cleared browser
loses unpublished work, which `/studio` says on the page rather than in a
footnote.

`/studio/[draft]` is five tabs, and they are the five things a generative
artist does before publishing: look at one piece, look at the space, decide
what a collector may change, prove the piece behaves, and find out what it
costs. The checks run the piece for real in detached frames, comparing one
seed across two fresh runs by capture digest.

A `.zip` is inlined into one document at load rather than at publish, so what
runs in the studio is byte for byte what goes on chain.

### Operating

```
/providers            ranked list
/providers/[address]  one provider's record
/docs/interface       ALEATORY-001, rendered
```

`/docs/interface` matters more than it looks. The interface spec is what makes
someone else's front end possible, and asking them to read it in a repository
is asking most people not to.

### Explaining

```
/about                what this is, how a piece works, what it costs
```

---

## Left

- **`/providers/[address]`.** The ranked list exists; one provider's own record
  does not.
- **Deploy actually signs.** `/studio/[draft]/publish` collects every field and
  checks the declaration, and the button still only connects the wallet. Pinning
  the generator and originating through the factory is the remaining step, and
  it is the one that makes the artist path end somewhere.

## Finding an artist's collections

A collection is originated by the factory, so its `creator` is the factory and
not the artist. What identifies the artist is `initiator` on the internal
origination: the account whose operation caused it. `/manage` and
`/wallet/[address]` both read it that way.

Filtering contracts by a storage field is the obvious approach and TzKT does
not support it. It ignores unknown query parameters and answers with an
unfiltered page, which reads as success.
