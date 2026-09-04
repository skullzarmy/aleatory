# Contributing

Aleatory is fully on-chain generative art on Tezos. A generator is one HTML
file stored on chain; a piece is that file plus a seed fixed at mint.

Everything here is public domain. Fork it, change it, compete with it. If you
want your change in this repository, this is how.

---

## Setting up

```
git clone https://github.com/skullzarmy/aleatory
cd aleatory
npm ci
cp .env.example .env
npm run dev
```

Node 24, which is what `.nvmrc` names and what CI runs. `package.json` allows
18.18 and up, so an older one will work for most things.

`.env` needs nothing filled in to browse the site. The addresses come from a
router contract on chain, and the example file says which variables exist and
what they do.

**Running a piece needs two servers.** Artwork executes on its own origin under
a policy that blocks the network, so anything that frames a generator, the
studio, a piece page, a collection page, needs the isolate running too:

```
npm run dev:all
```

**The admin console is a separate app** with its own dependencies and its own
Netlify site. `cd admin && npm ci` if you are working on it.

**The contracts need Python 3 with SmartPy.** Nothing else does, so skip this
unless you are changing them.

```
pip install smartpy-tezos
```

The package is `smartpy-tezos`. The bare name `smartpy` on PyPI is an unrelated
hydrology model that installs without complaint and then has none of the
functions the scenarios call.

---

## The loop

```
npm test          the suite
npm run lint      formatting, Biome
npx tsc --noEmit  types
npm run build     the production build
```

CI runs all four on your pull request. Running them first is faster than
waiting to be told.

Five of the tests read the chain and a package registry. Each skips its network
half when there is no connection, so the suite passes offline with fewer
assertions, and a flight is not a red build.

Tests here run the code they are about: a template is parsed, a zip is
packaged, a schema is resolved, an API route is called. Three source scans
survive and each earned it, `hooks.test.ts` is a lint rule for React hook
order, `check-contracts.mjs` compares the deploy script against what each
contract declares, and `conformance.test.ts` holds the two harness
implementations to the same spec. Each caught a bug that had shipped.

---

## Sending a change

Fork, branch, open a pull request against `main`. Nobody outside the project
pushes to `main` directly.

Small and focused lands faster than large and mixed. If a change is going to be
big, or touches the contracts, open an issue first so the shape can be agreed
before you write it.

`AGENTS.md` is the working document for the platform: what is where, what has
cost real time, and the conventions. Worth reading before a first change.

**Prose, in docs, comments, commit messages and replies.** Say what a thing is
and stop. Describe the model as it stands now. Four habits to keep out: em
dashes, "not an X, a Y" constructions, accounts of decisions since replaced,
and justification by contrast.

---

## Changing a contract

Pull requests against `contract/` are welcome on the same terms as anything
else. Four things make them different, and none of them are obvious from the
code.

**A collection's code is frozen at origination.** There is no upgrade path and
no authority retained by anyone. A change reaches nothing already deployed,
which is the price of the guarantee the platform is built on, and the reason
the template stays boring.

**Shipping one means a new factory.** The factory embeds the collection
template, so changing the template means originating a new factory and pointing
the router at it. The router keeps every factory it has ever named, because the
collections a retired one made are still real collections owned by real
artists.

**The checks are not optional.**

```
npm run build:contracts   compile
npm run test:contracts    the SmartPy scenarios
```

`scripts/check-contracts.mjs`, which the suite runs, compares
`contract/deploy.ts` storage against what each contract declares. Taquito
encodes an origination from the contract's own schema, so a field left behind
after a rename is dropped in silence and the deploy still succeeds.

**The template is audited before it reaches mainnet.** A bug in it is frozen
into every collection made from it, with no remedy.

---

## Things that will catch you

**A new top-level directory is invisible to git.** `.gitignore` ignores every
directory at the top level and allow-lists them back one at a time:

```
/*/
!/src/
!/docs/
```

Add `!/yourdir/` when you add one. Git will not warn you; the files simply do
not appear.

**Some documents are deliberately absent.** The decision log, the roadmap, the
audit and its response are working notes and are not in the repository. If a
comment cites one, that is a mistake and the suite now fails on it.

**Nothing in `.env` is committed.** Key material stays out of the repository.

---

## Reporting something

A bug or an idea goes in an issue. A security problem does not: see
[SECURITY.md](SECURITY.md).

How people are expected to behave here is in
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

---

## Licensing

This project is released into the public domain under
[the Unlicense](LICENSE). Opening a pull request releases your contribution the
same way. There is no copyright assignment and no agreement to sign, because
there is nothing to assign: the work belongs to everybody the moment it lands.
