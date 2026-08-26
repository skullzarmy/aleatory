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
/minted/[c]/[id]      the moment after a mint
/piece/[c]/[id]       one piece
/wallet/[address]     what someone holds and made
/mine                 shortcut to your own wallet page
```

`/wallet/[address]` is the page about a person: who they are, what they made,
what they hold. Created leads, because on a site about generative art the work
someone published is the reason to be on their page at all. It answers both
questions about one address because on this chain they are usually the same
person, and it is keyed by an address alone, so it needs no account, no
connection and no permission. `/mine` redirects to it, so "what you own" is one
link from anywhere without being a second copy of the same view behind a
connection.

The profile on top is theirs from elsewhere: hack.tez first, objkt as a
fallback. Nothing about a person is stored here. See [identity](identity.md),
which is also the one place that decides how any account is displayed anywhere
on the site.

`/minted/[c]/[id]` is where a mint lands. It runs the piece live from the
generator in the collection's storage and the seed the collector's signature
just fixed, before any image exists, and polls until the provider publishes
one. The collection page holds the collector while the operation is indexed,
because the contract decides the token id and it is not knowable until then;
if the indexer lags past the window, the panel says where the piece is instead
of spinning. Sharing from here points at `/piece/[c]/[id]`, since a page that
celebrates a purchase is only interesting to the person who made it.

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

`/studio/[draft]` is a split workbench: the document on the left, the piece on
the right, typing redraws. Generative work is a loop, change a number and look,
and the studio used to break it in half by hiding the document behind an Export
button. The seed is held still while you type, because a piece that rerolls on
every edit tells you nothing about the edit, and an error the piece throws is
reported rather than swallowed, because a blank frame and black paint look the
same.

A `.html` or `.zip` dropped on the editor replaces the document in place, so
importing is part of the loop rather than a thing you do once at the start.

Under the piece sit the other four things an artist does before publishing:
look at the space rather than one draw, decide what a collector may change,
prove the piece behaves, and find out what it costs. The checks run the piece
for real in detached frames, comparing one seed across two fresh runs by
capture digest.

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

- **p5 is unpinned.** `P5_DEP.expectedHash` is empty, so `resolveDep` hashes
  whatever the CDN returns and writes that hash on chain as canonical. It has to
  carry a verified value before any mainnet publish.
- **Pieces from a retired factory.** The router keeps old factories so their
  collections stay visible, and a collection whose provider has stopped serving
  it says its image is being made forever. Nothing renders them and nothing says
  so.

## Finding an artist's collections

A collection is originated by the factory, so its `creator` is the factory and
not the artist. What identifies the artist is `initiator` on the internal
origination: the account whose operation caused it. `/manage` and
`/wallet/[address]` both read it that way.

Filtering contracts by a storage field is the obvious approach and TzKT does
not support it. It ignores unknown query parameters and answers with an
unfiltered page, which reads as success.

A single-field `select` is flattened: TzKT answers with the field's own value
per row, not a row containing that field. Reading `row.originatedContract` found
`undefined` on every row, so both pages told every artist they had published
nothing.
