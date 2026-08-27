# Aleatory admin

The operator console: what the business holds, and the controls that move it.

Separate from the public site on purpose. It deploys as its own Netlify site
from this directory, on its own subdomain, with its own dependencies. Nothing
here is imported by `../src` and nothing there is imported by this.

```
npm install
cp .env.example .env     # fill in at least the router
npm run dev              # http://localhost:3100
npm test                 # encodes every operation against the live contracts
```

## It holds no keys

There is no server-side signer, no private key in the environment, and no
session. Every privileged action is authorised on chain by whichever address
signs it, so this app being reachable is not a security boundary and being
logged in to it grants nothing.

That is why the console is safe to deploy without an auth layer, and why it
still sets `noindex`: there is nothing to steal here, and nothing to find.

## Where the money is

| Holder | Contains | Moved by |
| --- | --- | --- |
| Marketplace | platform fees, royalties owed to artists, offers in escrow | **anyone** |
| Factory | deploy fees | **anyone** |
| Provider | render gas collected from mints | operator key, to anywhere |
| Agent `tz1` | gas the daemon spends publishing | the daemon itself |

Sweeps on the marketplace and the factory are permissionless because the
destination is fixed in each contract's storage. There is nothing to steal by
calling them, so the treasury address never has to sign, and never has to be
online. The provider's `withdraw` is the exception: it is operator-gated and
takes a destination, which makes it the one call here that a signature can
misdirect.

The marketplace balance is three people's money at once, so the console
reports it decomposed and shows what is left over. That figure should be zero.
Anything else means either tez arrived that nothing accounts for, or the
contract has promised more than it holds and a claim is going to fail.

## Handing over to a multisig

Actions never send. Each one builds an `AdminOp` in `src/lib/ops.ts`, and a
sink decides what happens to it: sign it with the connected wallet, or export
it as a proposal for something else to submit. A `KT1` multisig cannot hold a
wallet session, so when administration moves to one, the buttons that sign
today export instead and no action needs rewriting.

The console already shows the state that transition runs through. Every
contract with an administrator uses a two-step handover, `propose_admin` then
`accept_admin` called by the proposed address, so a typo cannot strand it. A
pending proposal is displayed wherever one exists.

## Configuration

Only `NEXT_PUBLIC_ROUTER_ADDRESS` really has to be set. The router is the
platform's index, and the live factory is read from it rather than from an
environment variable, because the two drift and the router is the one the
contracts believe.

`NEXT_PUBLIC_PROVIDER_ADDRESS` is not discoverable and has to be set by hand.
The registry lists every provider on the platform and has no notion of which
one is yours.
