# Security

## Reporting a vulnerability

**Do not open an issue.** An issue is public, and for a contract bug that is
the disclosure.

Use GitHub's private vulnerability reporting, on the
[Security tab](https://github.com/skullzarmy/aleatory/security/advisories/new)
of this repository. It is private between you and the maintainers, and it lets
us prepare a fix before anything is said publicly.

If that form is not available, say so on
[Discord](https://discord.gg/3kFMF8gUxP) without describing the problem, and
ask for a private channel.

Expect an acknowledgement within a few days. If the report is one we act on, we
will tell you when it is fixed and credit you unless you would rather we did
not.

---

## What is in scope

**The contracts**, in `contract/`. Anything that lets somebody take tez or a
token that is not theirs, mint outside the rules a collection set, write
metadata they are not authorised to write, or permanently prevent a collection
from selling or a piece from being rendered.

**The site**, in `src/`. Anything that reaches wallet state or another origin's
data from artwork, forges what a piece is, or gets a visitor to sign something
other than what they were shown.

**The isolate**, in `isolate/`. Artwork runs there under a policy that blocks
the network. An escape from that sandbox is the most serious thing on this
list.

**The provider and the bot**, in `provider/` and `bot/`. Anything that gets a
piece published with contents nobody signed for, or that reaches an operator's
keys.

Also in scope, and easy to overlook: a way to make a renderer accept library
bytes that do not match the digest recorded on chain.

---

## What is not

Findings that need an operator's private key, physical access to their machine,
or a compromised dependency of a dependency with no path from here.

Reports from a scanner with no demonstrated path to any of the above.

The absence of a rate limit on public read endpoints. They serve public chain
data and are cached.

---

## Which network

Everything is on **shadownet**, a test network. The tez has no value and
nothing lost there is real. That makes the reporting easier, not less useful:
the contracts being examined now are the ones that will hold real money later,
and a bug in the collection template is frozen into every collection made from
it, forever, with no upgrade path.

The template is audited before it reaches mainnet. Anything found before then
is worth considerably more than anything found after.
