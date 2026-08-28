# Contracts

Seven contracts in SmartPy. Four we administer, one nobody can, one belongs to
whoever runs it, and one to the artist who deployed it.

| Contract | Owns | Controlled by |
|---|---|---|
| **Router** | Which factory, marketplace, registry and resolver are current | Us. Two-step admin. |
| **Factory** | The collection template, and a record of what it deployed | Us. Two-step admin. |
| **Marketplace** | Listings, offers, fees, royalties owed | Us. Two-step admin. |
| **Resolver** | Which keys may write resolution entries | Us. Two-step admin. |
| **Collection** | One generator, one edition, its tokens | The artist, from origination |
| **Provider** | One renderer's price and working key | Whoever runs it |
| **Registry** | The list of providers | Nobody. Permissionless, free. |

## Two rules that shape everything else

**The collection has no escape hatch.** No lambda, no upgrade path, no
authority retained by us. A bug in the template is frozen into every collection
already deployed. That is the price of telling an artist their work cannot be
taken from them, and the reason the template stays boring and is audited before
it ships.

**The factory holds no tokens.** It never custodies anything of anyone's, which
is what makes an administrative lambda safe there and unsafe in a collection.

Changing the template means deploying a new factory. Existing collections are
untouched and nothing migrates. The router keeps every factory it has ever
pointed at, so a collection deployed two factories ago still resolves.

## Deploying a collection

One operation. The artist calls `deploy`, and the factory originates the
collection in that same operation with the artist already installed as
administrator in the initial storage. Nothing is held by us and handed over,
and there is no second signature.

The template is compiled once and lives as Michelson inside the factory, so
every collection is byte-identical code and only storage differs. Anyone can
verify a collection is the real template by comparing code hashes. There is no
build server and no key custody in the path.

Storage burn and gas are charged to the operation's source, which is the
artist's wallet, as Tezos charges all storage to the payer. We front nothing
and we charge nothing: `deploy_price` is zero. It exists as an admin-settable
field so an anti-spam lever is possible later without a new factory, and any
change to it would be visible on chain.

## Minting

One signature. The collector pays `price + render_gas`, and the contract splits
it in that same operation: the price to the artist, the render gas to the
provider the artist chose. The contract's balance is zero when it returns.
There is nothing to drain and no withdraw entrypoint.

The seed is the hash of that operation. Nobody selects it and nobody can
predict it, which is the property the whole platform rests on.

## Working on them

```
npm run build:contracts     compile to Michelson
npm run test:contracts      the SmartPy scenarios
npm run deploy              originate, --dry-run to preview
```

`aleatory.py` holds the router, factory, resolver, provider, registry and the
collection template. `marketplace.py` is separate because it is separately
deployable and separately replaceable.

Tests are in `tests_aleatory.py`, `tests_marketplace.py` and
`tests_integration.py`.

## Further

- [ALEATORY-001](../docs/interface.md) is the interface a conforming collection
  implements, written so somebody can build against it without this source.
- [architecture.md](../docs/architecture.md) is how the pieces fit and why.
- [deploying.md](../docs/deploying.md) is standing up an instance.
