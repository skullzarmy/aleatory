# Names, faces and profiles

**Status:** built, 2026-08-26.

Nothing about a person is stored here. Every name, picture, bio and link on the
site is read from somewhere its owner controls, which is why an artist has a
page from the moment they deploy rather than when they get round to making an
account. There is no account to make.

One module does all of it: `src/lib/identity.ts`. Nothing else fetches a name.

---

## Resolving a name

Three sources, tried in order, first answer wins:

1. **The Tezos Domains reverse record.** There is at most one, it points at the
   wallet rather than being merely owned by it, and the holder sets it
   deliberately. That makes it the closest thing to a declared identity.
2. **The hack.tez domain the owner designated as their identity.** A wallet can
   own several, and one is marked on chain.
3. **Their TzKT profile alias.**

The first two arrive together from `GET /api/v1/resolve/:address` on hack.tez,
whose `primary` field is already that order. One CDN-cached call rather than two
GraphQL round trips against Tezos Domains.

**Read `hackTezPrimary`, never `hackTez[0]`.** The array is not ordered by
significance. Taking its first entry showed the operator of hack.tez as
`admin.hack.tez`, the site's own admin account, rather than as themselves.

No answer means no name, and the caller shows the truncated address. Callers are
never handed a pre-truncated string, so how to abbreviate stays with the surface
doing the rendering.

## Resolving a profile

Two sources, and the order is the point.

**hack.tez is primary.** It is a profile its owner edits directly, in on-chain
records they hold, and it is where we ask people to keep this. The profile read
is the one attached to their designated domain, so someone holding ten domains
gets the one that is actually them.

**objkt is the fallback**, because its `holder` row aggregates tzprofiles and
objkt's own profiles and therefore already knows almost every Tezos artist who
has ever filled in a form. An artist who has never heard of us still arrives
with a face.

A hack.tez domain registered but never filled in falls through to objkt rather
than showing a blank profile: an empty record is not a preference.

The two sources disagree on shape, since hack.tez stores bare handles and objkt
stores whole URLs. `link()` normalises both into `{ kind, label, href }`, so
nothing downstream knows or cares which answered.

## Which chain

Names and profiles resolve against **mainnet** whatever network the site points
at. A key is the same key on every chain and someone's name should not vanish
because they are testing. The TzKT alias is the exception: that is a
per-instance profile, so it comes from the network in use.

## Cost

Answers are cached for ten minutes and in-flight requests are deduplicated, so a
grid of forty pieces by one artist asks once. Lookups are gated at six
concurrent: forty cards by forty artists is forty lookups, and firing them
together buries the chain reads behind a queue of decoration. Names arrive
progressively, which costs nothing, because every one of them is already showing
an address.

`fetchProfile` is a second hop and belongs only on pages about one person. A
feed wants `resolveName`.

---

## Showing an account

| What | Component |
| --- | --- |
| A name inline | `<AccountName>` |
| A name that goes somewhere | `<AccountLink>` |
| A face | `<Avatar>` |
| The block at the top of someone's page | `<ProfileCard>` |

`<AccountLink>` is the default and goes to `/wallet/{address}`. Sending a reader
to a block explorer was the old behaviour, and an explorer is where you go to
check an operation, not to find out who made something. The explorer link still
exists: once, in `<ProfileCard>`, next to the address it verifies.

**Inside something that is already a link, use `<AccountName>`.** A feed card
and a market row are links across their whole body, and an anchor inside an
anchor is invalid HTML that React refuses to hydrate. The rule is the container:
if it is a link, the account is a name.

`<Avatar>` never renders an empty circle. Their picture, else the hackatar when
they have a hack.tez name, else their initial. A grid of identical blank discs
reads as broken rather than as absent.

Contracts are not accounts. A collection and a provider carry their own name and
logo in their metadata, so they pass `src` explicitly and use `shape="square"`.
Hashes are hashes and stay truncated.

## Telling people where it comes from

`<ProfileNudge>` says it, and only to the person whose page it is. Informing a
visitor that the artist they are reading about has not filled in a form is
neither their business nor useful to them.

It appears in two cases: no profile at all, and a profile inherited from objkt
that the owner may not know is on display.

---

## Content security

Three origins have to be allowed or the whole thing fails silently:
`connect-src` needs the resolver and `data.objkt.com`, `img-src` needs the
resolver (hackatars) and `assets.objkt.media` (objkt logos). A blocked avatar
renders as an initial and a blocked name renders as an address, so neither
failure announces itself. `next.config.ts` derives all of them from
`NEXT_PUBLIC_HACKTEZ_API`.
