"""Aleatory — factory, collection, and minter resolver.

Three contracts, and the split between them is the whole design.

**Resolver** — one tiny contract holding the set of backend minting keys.
Collections consult it, so a leaked soft wallet is rotated in one place
instead of once per collection ever deployed.

**Collection** — one per project, originated by the factory, owned by the
artist from the moment it exists. Standard FA2 (TZIP-12) + TZIP-21, holding
exactly one generator and its edition. **No admin lambda, no upgrade path,
no platform fee, and no authority retained by us.** The artist is the only
administrator. Editions are immutable to everyone including them.

**Factory** — takes a flat deploy fee and originates a collection in the
same operation, with the caller already installed as its administrator.
Holds no tokens, so its `admin_lambda` escape hatch cannot reach anyone's
NFT. That is the point of the split: the contract that needs to be
upgradable holds nothing, and the contract that holds everything cannot be
touched.

Storage burn and gas for the origination are charged to the operation's
source — the artist's wallet — as Tezos charges all storage to the payer,
including for internal originations. The factory never fronts anything and
never holds an artist's collection.

The template is a starting point, not a requirement. Anything that is
standard FA2 + TZIP-21 gets indexed, rendered and traded. What a
third-party contract must match to use our render-and-mint backend is the
`buy`/`mint` interface below, not this implementation. The interface is the
artifact that has to be right; this file is its reference implementation.

The mint flow, unchanged from architecture.md §4a:

1. **`buy`** — the collector's single signature. Pays the artist, writes a
   reservation. The operation hash is the seed source.
2. **`mint`** — a backend minter, having rendered and pinned the piece,
   consumes the reservation. The recipient comes from the reservation, so a
   stolen key cannot redirect a paid piece or mint the same payment twice.

Deploy to shadownet first, soak-test, then mainnet.
"""

import smartpy as sp
from smartpy.templates import fa2_lib as fa2

main = fa2.main


@sp.module
def aleatory():
    import main

    # What the factory writes into a new collection's storage. Everything
    # here except `administrator` is fixed for the life of the contract.
    t_collection_init: type = sp.record(
        administrator=sp.address,
        resolver=sp.address,
        provider=sp.address,
        render_price=sp.mutez,
        code_uri=sp.string,
        # The same URI as bytes, because TZIP-21 `token_info` values are
        # bytes and Michelson cannot convert a string at runtime.
        code_uri_bytes=sp.bytes,
        code_hash=sp.bytes,
        edition_size=sp.nat,
        price=sp.mutez,
        # Pre-encoded TZIP-21 royalty shares, written verbatim into every
        # token. Encoded off chain because the on-chain form is JSON.
        royalties=sp.bytes,
        # The parameter declaration (params.md §2), immutable. Empty bytes
        # when the generator declares none — absent and empty must never
        # both mean the same thing, so readers key off length.
        params_schema=sp.bytes,
        token_name=sp.bytes,
        placeholder_uri=sp.bytes,
        metadata=sp.big_map[sp.string, sp.bytes],
    )

    # The collection's complete storage. Declared explicitly because the
    # factory has to construct this exact shape in `sp.create_contract`;
    # the child casts `self.data` to it so the two can never drift apart
    # silently.
    t_collection_storage: type = sp.record(
        administrator=sp.address,
        proposed_admin=sp.option[sp.address],
        resolver=sp.address,
        local_minters=sp.set[sp.address],
        provider=sp.address,
        render_price=sp.mutez,
        media_due=sp.big_map[sp.nat, sp.mutez],
        escrowed=sp.mutez,
        code_uri=sp.string,
        code_uri_bytes=sp.bytes,
        code_hash=sp.bytes,
        edition_size=sp.nat,
        price=sp.mutez,
        royalties=sp.bytes,
        params_schema=sp.bytes,
        token_name=sp.bytes,
        placeholder_uri=sp.bytes,
        paused=sp.bool,
        retired=sp.bool,
        ledger=sp.big_map[sp.nat, sp.address],
        operators=sp.big_map[
            sp.record(
                owner=sp.address, operator=sp.address, token_id=sp.nat
            ).layout(("owner", ("operator", "token_id"))),
            sp.unit,
        ],
        token_metadata=sp.big_map[
            sp.nat,
            sp.record(
                token_id=sp.nat, token_info=sp.map[sp.string, sp.bytes]
            ).layout(("token_id", "token_info")),
        ],
        metadata=sp.big_map[sp.string, sp.bytes],
        next_token_id=sp.nat,
    )

    # ---------------------------------------------------------------
    # Resolver
    # ---------------------------------------------------------------

    class AleatoryResolver(sp.Contract):
        """The one place backend minting keys are listed.

        Collections call `is_minter` as an on-chain view. Rotating a leaked
        soft wallet is one operation here rather than one per collection.

        The cost of that convenience, stated plainly: whoever administers
        this contract can authorise a minter into every collection that
        trusts it. Collections keep their own local minter set as an
        override precisely so this is not absolute — see
        `AleatoryCollection.is_authorised_minter_`.
        """

        def __init__(self, administrator, minters):
            self.data.administrator = administrator
            self.data.proposed_admin = sp.cast(None, sp.option[sp.address])
            self.data.minters = sp.cast(minters, sp.set[sp.address])

        @sp.entrypoint
        def propose_admin(self, new_admin):
            sp.cast(new_admin, sp.address)
            assert sp.amount == sp.mutez(0), "TEZ_NOT_ACCEPTED"
            assert sp.sender == self.data.administrator, "NOT_ADMIN"
            self.data.proposed_admin = sp.Some(new_admin)

        @sp.entrypoint
        def accept_admin(self):
            assert sp.amount == sp.mutez(0), "TEZ_NOT_ACCEPTED"
            assert self.data.proposed_admin == sp.Some(
                sp.sender
            ), "NOT_PROPOSED_ADMIN"
            self.data.administrator = sp.sender
            self.data.proposed_admin = None

        @sp.entrypoint
        def add_minter(self, minter):
            sp.cast(minter, sp.address)
            assert sp.amount == sp.mutez(0), "TEZ_NOT_ACCEPTED"
            assert sp.sender == self.data.administrator, "NOT_ADMIN"
            self.data.minters.add(minter)
            sp.emit(sp.record(minter=minter), tag="add_minter")

        @sp.entrypoint
        def remove_minter(self, minter):
            """Instantly disables a retired or leaked key everywhere."""
            sp.cast(minter, sp.address)
            assert sp.amount == sp.mutez(0), "TEZ_NOT_ACCEPTED"
            assert sp.sender == self.data.administrator, "NOT_ADMIN"
            self.data.minters.remove(minter)
            sp.emit(sp.record(minter=minter), tag="remove_minter")

        @sp.onchain_view()
        def is_minter(self, minter):
            sp.cast(minter, sp.address)
            return minter in self.data.minters

    # ---------------------------------------------------------------
    # Collection
    # ---------------------------------------------------------------

    class AleatoryCollection(
        main.Nft,
        main.OnchainviewBalanceOf,
        main.OffchainviewTokenMetadata,
    ):
        """One project: one generator, one edition, owned by the artist.

        Deliberately has no escape hatch. There is no `admin_lambda`, no
        code upgrade, and no entrypoint that touches a collector's token
        beyond the one-time media write below — not for the artist, not for
        the factory, not for us. A bug in this template is frozen into every
        collection already deployed, which is the price of that guarantee
        and the reason this contract stays boring.

        The artist administers it: pause, reprice, retire, choose a render
        provider, and a local minter override. `code_uri`, `code_hash`,
        `edition_size`, `royalties` and `params_schema` have no setter
        anywhere.
        """

        def __init__(self, init):
            sp.cast(init, t_collection_init)

            main.OnchainviewBalanceOf.__init__(self)
            main.OffchainviewTokenMetadata.__init__(self)
            main.Nft.__init__(self, init.metadata, {}, [])

            self.data.administrator = init.administrator
            self.data.proposed_admin = sp.cast(None, sp.option[sp.address])

            # Where backend minting keys are resolved from. Fixed at
            # origination: a collection that could be pointed at a
            # different resolver later would be a collection whose minting
            # authority we could seize after the fact.
            self.data.resolver = init.resolver
            self.data.local_minters = sp.cast(set(), sp.set[sp.address])

            # The render provider and the per-piece price agreed with them,
            # snapshotted. `buy` never calls out to the provider's contract
            # — a sale must not depend on a contract the artist chose and we
            # cannot audit. Re-snapshot via `set_provider`.
            self.data.provider = init.provider
            self.data.render_price = init.render_price
            # Render fees held for pieces awaiting their image, and the sum
            # of them. Everything else this contract receives is forwarded
            # within the same operation.
            self.data.media_due = sp.cast(
                sp.big_map(), sp.big_map[sp.nat, sp.mutez]
            )
            self.data.escrowed = sp.mutez(0)

            # Immutable, all of it.
            self.data.code_uri = init.code_uri
            self.data.code_uri_bytes = init.code_uri_bytes
            self.data.code_hash = init.code_hash
            self.data.edition_size = init.edition_size
            self.data.params_schema = init.params_schema
            self.data.token_name = init.token_name
            self.data.royalties = init.royalties
            self.data.placeholder_uri = init.placeholder_uri

            self.data.price = init.price
            self.data.paused = False
            self.data.retired = False

            # Fails to compile if this shape ever drifts from what the
            # factory constructs in `deploy`.
            sp.cast(self.data, t_collection_storage)

        @sp.private(with_storage="read-only")
        def is_artist_(self):
            return sp.sender == self.data.administrator

        # --- artist administration ---

        @sp.entrypoint
        def propose_admin(self, new_admin):
            """Two-step handoff, so a mistyped address cannot orphan an
            artist's own collection."""
            sp.cast(new_admin, sp.address)
            assert sp.amount == sp.mutez(0), "TEZ_NOT_ACCEPTED"
            assert self.is_artist_(), "NOT_ARTIST"
            self.data.proposed_admin = sp.Some(new_admin)
            sp.emit(sp.record(proposed_admin=new_admin), tag="propose_admin")

        @sp.entrypoint
        def accept_admin(self):
            assert sp.amount == sp.mutez(0), "TEZ_NOT_ACCEPTED"
            assert self.data.proposed_admin == sp.Some(
                sp.sender
            ), "NOT_PROPOSED_ADMIN"
            self.data.administrator = sp.sender
            self.data.proposed_admin = None
            sp.emit(sp.record(new_admin=sp.sender), tag="accept_admin")

        @sp.entrypoint
        def set_price(self, price):
            """Reprice the unsold remainder. Never retroactive."""
            sp.cast(price, sp.mutez)
            assert sp.amount == sp.mutez(0), "TEZ_NOT_ACCEPTED"
            assert self.is_artist_(), "NOT_ARTIST"
            assert not self.data.retired, "RETIRED"
            self.data.price = price
            sp.emit(sp.record(price=price), tag="set_price")

        @sp.entrypoint
        def set_paused(self, new_state):
            """Pause the **sale**. Transfers of existing pieces are never
            affected — a paused project still trades on the secondary
            market."""
            sp.cast(new_state, sp.bool)
            assert sp.amount == sp.mutez(0), "TEZ_NOT_ACCEPTED"
            assert self.is_artist_(), "NOT_ARTIST"
            self.data.paused = new_state
            sp.emit(sp.record(paused=new_state), tag="set_paused")

        @sp.entrypoint
        def retire(self):
            """Permanently close the edition to new sales. One-way, and it
            never touches pieces already sold."""
            assert sp.amount == sp.mutez(0), "TEZ_NOT_ACCEPTED"
            assert self.is_artist_(), "NOT_ARTIST"
            self.data.retired = True
            self.data.paused = True
            sp.emit(sp.record(at=self.data.next_token_id), tag="retire")

        @sp.entrypoint
        def set_provider(self, provider, max_price):
            """(Artist only) Choose who renders this collection's images,
            and snapshot their price.

            The price is read from the provider's own contract, which must
            expose a `get_render_price` view — that view is the entire
            membership test for being a provider. Anyone can deploy one.

            `max_price` is the artist's ceiling, so a provider raising
            their price between quote and signature fails the call rather
            than silently charging more.

            Switchable on purpose. A provider that is down, overpriced, or
            gone must not be able to strand a collection: fees already held
            for unrendered pieces stay with the contract and are paid to
            whoever actually delivers the image.
            """
            sp.cast(provider, sp.address)
            sp.cast(max_price, sp.mutez)
            assert sp.amount == sp.mutez(0), "TEZ_NOT_ACCEPTED"
            assert self.is_artist_(), "NOT_ARTIST"
            quoted = sp.view(
                "get_render_price", provider, (), sp.mutez
            ).unwrap_some(error="NO_PROVIDER_VIEW")
            assert quoted <= max_price, "PRICE_ABOVE_MAX"
            self.data.provider = provider
            self.data.render_price = quoted
            sp.emit(
                sp.record(provider=provider, render_price=quoted),
                tag="set_provider",
            )

        @sp.entrypoint
        def set_local_minter(self, minter, allowed):
            """(Artist only) Authorise a media writer directly, bypassing
            the resolver. The artist's insurance against a resolver that is
            broken, captured, or gone."""
            sp.cast(minter, sp.address)
            sp.cast(allowed, sp.bool)
            assert sp.amount == sp.mutez(0), "TEZ_NOT_ACCEPTED"
            assert self.is_artist_(), "NOT_ARTIST"
            if allowed:
                self.data.local_minters.add(minter)
            else:
                self.data.local_minters.remove(minter)
            sp.emit(
                sp.record(minter=minter, allowed=allowed),
                tag="set_local_minter",
            )

        # --- sale ---

        @sp.entrypoint
        def buy(self, params):
            """(Anyone, payable) Buy one edition. One signature, and the
            token exists when it returns.

            **The piece is minted here, in the collector's own operation.**
            Code, parameters, royalties and provenance are all written now;
            the only thing missing is a raster image, and until a provider
            supplies one the token shows `placeholder_uri`. An unrevealed
            piece is a complete artwork with a pending thumbnail, not a
            promise of a future token — which is why there is no reservation
            to strand, no refund to argue about, and nothing a dead
            provider can take away.

            THIS OPERATION'S HASH IS THE SEED SOURCE, and it is also the
            operation that mints, so the binding needs no extra record: a
            token's seed is derived from the hash of the operation that
            created it (architecture.md §5).

            It does *not* make grinding expensive — the hash covers
            sender-controlled fields, so candidates are enumerated offline
            and only the chosen one is injected. That is the documented
            tradeoff of an op-hash seed.

            `params` is the canonical-JSON encoding of the collector's
            resolved parameter values (params.md §3), empty when the
            generator declares none. It is written into the token here, by
            the collector's own signature, so nobody can alter what they
            chose afterwards.

            Payment is `price + render_price`. The price goes to the artist
            immediately; the render fee is held against this token and paid
            out when the image is delivered — never before, so nobody is
            paid for work not done.
            """
            sp.cast(params, sp.bytes)
            assert not self.data.paused, "PAUSED"
            assert not self.data.retired, "RETIRED"
            assert (
                sp.amount == self.data.price + self.data.render_price
            ), "WRONG_PRICE"
            # edition_size 0 is an open edition.
            assert (
                self.data.edition_size == 0
                or self.data.next_token_id < self.data.edition_size
            ), "SOLD_OUT"

            token_id = self.data.next_token_id

            # Composed here, from immutable collection state plus what the
            # collector chose. Nothing about the token's metadata is
            # supplied by a backend, so there is no arbitrary-URI hole to
            # defend: the only fields any provider may ever write are the
            # two image URIs, once, in `set_media`.
            token_info = sp.cast(
                {
                    "decimals": sp.bytes("0x30"),  # "0"
                    "name": self.data.token_name,
                    "artifactUri": self.data.code_uri_bytes,
                    "displayUri": self.data.placeholder_uri,
                    "thumbnailUri": self.data.placeholder_uri,
                    "royalties": self.data.royalties,
                    "aleaCodeHash": self.data.code_hash,
                    "aleaParams": params,
                    "aleaParamsSchema": self.data.params_schema,
                },
                sp.map[sp.string, sp.bytes],
            )
            self.data.token_metadata[token_id] = sp.record(
                token_id=token_id, token_info=token_info
            )
            self.data.ledger[token_id] = sp.sender
            self.data.next_token_id += 1

            if self.data.render_price > sp.mutez(0):
                self.data.media_due[token_id] = self.data.render_price
                self.data.escrowed += self.data.render_price

            if self.data.price > sp.mutez(0):
                sp.send(self.data.administrator, self.data.price)

            sp.emit(
                sp.record(
                    token_id=token_id,
                    buyer=sp.sender,
                    params=params,
                    paid=sp.amount,
                    render_fee=self.data.render_price,
                ),
                tag="buy",
            )

        # --- media ---

        @sp.private(with_storage="read-only")
        def may_write_media_(self, who):
            """The collection's own provider, an address the artist
            authorised directly, or one the resolver vouches for.

            The resolver is consulted through a view that may fail — if it
            is gone or broken the call yields nothing and we fall through,
            rather than reverting. A dead resolver must not permanently
            freeze every collection that trusted it.
            """
            sp.cast(who, sp.address)
            allowed = who == self.data.provider
            if not allowed:
                allowed = who in self.data.local_minters
            if not allowed:
                resolved = sp.view(
                    "is_minter", self.data.resolver, who, sp.bool
                )
                allowed = resolved == sp.Some(True)
            return allowed

        @sp.entrypoint
        def set_media(self, token_id, display_uri, thumbnail_uri):
            """(Authorised writer) Write a piece's rendered images, once.

            This is the only entrypoint in the contract that modifies an
            existing token, and it is deliberately the narrowest one that
            can do the job: two URI fields, on a token that has no image
            yet, and never again afterwards. It cannot touch the artwork,
            the parameters, the royalties, the owner, or any other token.

            Payment is released here, to whoever delivered — which is why
            it goes to `sp.sender` rather than to the stored provider. An
            artist who switches providers has their outstanding pieces
            rendered by the new one, and the fee follows the work.

            Writing an image that does not match the piece is possible and
            not preventable on chain. It is detectable by anyone: the seed
            comes from the mint operation and the parameters are in the
            token, so the correct image is reproducible. Detection, and key
            rotation, rather than a guarantee we cannot make.
            """
            sp.cast(token_id, sp.nat)
            sp.cast(display_uri, sp.bytes)
            sp.cast(thumbnail_uri, sp.bytes)
            assert sp.amount == sp.mutez(0), "TEZ_NOT_ACCEPTED"
            assert self.may_write_media_(sp.sender), "NOT_AUTHORISED"
            assert sp.len(display_uri) > 0, "EMPTY_DISPLAY_URI"

            # Present exactly once: absent means either never sold or
            # already rendered, and both mean there is nothing to write.
            fee = self.data.media_due.get(token_id, error="NO_MEDIA_DUE")
            del self.data.media_due[token_id]

            token = self.data.token_metadata[token_id]
            token.token_info["displayUri"] = display_uri
            token.token_info["thumbnailUri"] = thumbnail_uri
            self.data.token_metadata[token_id] = token

            if fee > sp.mutez(0):
                self.data.escrowed -= fee
                sp.send(sp.sender, fee)

            sp.emit(
                sp.record(
                    token_id=token_id,
                    display_uri=display_uri,
                    renderer=sp.sender,
                    fee=fee,
                ),
                tag="set_media",
            )

        # --- views ---

        @sp.onchain_view()
        def get_media_due(self, token_id):
            """The fee held for a piece still awaiting its image. Fails once
            rendered, so a provider can check before doing the work."""
            sp.cast(token_id, sp.nat)
            return self.data.media_due.get(token_id, error="NO_MEDIA_DUE")

        @sp.onchain_view()
        def get_edition(self):
            """Everything needed to rebuild the edition from chain state."""
            return sp.record(
                artist=self.data.administrator,
                code_uri=self.data.code_uri,
                code_hash=self.data.code_hash,
                params_schema=self.data.params_schema,
                edition_size=self.data.edition_size,
                minted=self.data.next_token_id,
                price=self.data.price,
                render_price=self.data.render_price,
                provider=self.data.provider,
                paused=self.data.paused,
                retired=self.data.retired,
            )


    # ---------------------------------------------------------------
    # Provider
    # ---------------------------------------------------------------

    class AleatoryProvider(sp.Contract):
        """A render provider's price, on chain.

        This contract is not required — anything exposing a
        `get_render_price` view is a provider, and that view is the whole
        membership test. It is here as the reference implementation so that
        "run your own renderer and sell the service" is a deploy, not a
        negotiation.

        Collections snapshot the quote when the artist picks the provider,
        so a price change never affects a collection that already agreed to
        an older one until its artist re-snapshots.
        """

        def __init__(self, operator, render_price):
            self.data.operator = operator
            self.data.render_price = render_price

        @sp.entrypoint
        def set_render_price(self, price):
            sp.cast(price, sp.mutez)
            assert sp.amount == sp.mutez(0), "TEZ_NOT_ACCEPTED"
            assert sp.sender == self.data.operator, "NOT_OPERATOR"
            self.data.render_price = price
            sp.emit(sp.record(price=price), tag="set_render_price")

        @sp.onchain_view()
        def get_render_price(self):
            return self.data.render_price

    # ---------------------------------------------------------------
    # Factory
    # ---------------------------------------------------------------

    t_factory_storage: type = sp.record(
        administrator=sp.address,
        proposed_admin=sp.option[sp.address],
        paused=sp.bool,
        deploy_price=sp.mutez,
        treasury=sp.address,
        fees_accrued=sp.mutez,
        resolver=sp.address,
        collections=sp.big_map[sp.nat, sp.address],
        next_collection_id=sp.nat,
    )

    def identity_lambda(storage):
        """Test-only. Must live inside the module."""
        sp.cast(storage, t_factory_storage)
        return storage

    class AleatoryFactory(sp.Contract):
        """Originates collections. Holds no tokens, ever.

        Because it holds nothing, `admin_lambda` here cannot reach anyone's
        NFT — which is exactly why the escape hatch lives on this contract
        and not on the one that holds the art.

        What the lambda can and cannot do, precisely: it transforms factory
        *storage*. It cannot change the collection template, because that
        template is Michelson code compiled into this contract and contract
        code is immutable. A new template means a new factory — which is
        cheap, since old collections are untouched and nothing migrates.
        """

        def __init__(self, administrator, treasury, deploy_price, resolver):
            self.data.administrator = administrator
            self.data.proposed_admin = sp.cast(None, sp.option[sp.address])
            self.data.paused = False
            self.data.deploy_price = deploy_price
            self.data.treasury = treasury
            self.data.fees_accrued = sp.mutez(0)
            self.data.resolver = resolver
            self.data.collections = sp.cast(
                sp.big_map(), sp.big_map[sp.nat, sp.address]
            )
            self.data.next_collection_id = 0
            sp.cast(self.data, t_factory_storage)

        @sp.private(with_storage="read-only")
        def is_administrator_(self):
            return sp.sender == self.data.administrator

        @sp.entrypoint
        def deploy(self, params):
            """(Anyone, payable) Originate a collection in one operation.

            The caller is installed as the collection's administrator in
            its *initial storage* — it is never held by us and handed over.
            One signature, no second step, nothing of the artist's passing
            through our hands.

            Storage burn and gas for the origination are charged to the
            operation's source, which is the artist's wallet. The factory
            fronts nothing. `deploy_price` is purely our fee, taken once,
            here, and never again: collections carry no platform fee on
            sales.

            Note for callers: the artist's operation needs a storage limit
            large enough for the child contract. Wallet estimation handles
            this; anything hardcoded will break the day the template grows.
            """
            sp.cast(
                params,
                sp.record(
                    code_uri=sp.string,
                    code_hash=sp.bytes,
                    code_uri_bytes=sp.bytes,
                    edition_size=sp.nat,
                    price=sp.mutez,
                    royalties=sp.bytes,
                    params_schema=sp.bytes,
                    token_name=sp.bytes,
                    placeholder_uri=sp.bytes,
                    provider=sp.address,
                    max_render_price=sp.mutez,
                    metadata=sp.big_map[sp.string, sp.bytes],
                ),
            )
            assert not self.data.paused, "PAUSED"
            assert sp.amount == self.data.deploy_price, "WRONG_FEE"
            assert sp.len(params.code_uri) > 0, "EMPTY_CODE_URI"

            # The provider quotes its own price through a view it exposes;
            # that view is the entire membership test for being a provider.
            # `max_render_price` is the artist's ceiling, so a provider
            # raising their price between quote and signature fails the
            # deploy rather than quietly charging more.
            quoted = sp.view(
                "get_render_price", params.provider, (), sp.mutez
            ).unwrap_some(error="NO_PROVIDER_VIEW")
            assert quoted <= params.max_render_price, "PRICE_ABOVE_MAX"

            self.data.fees_accrued += sp.amount

            # `sp.create_contract` takes the child's *complete* initial
            # storage, so every field the FA2 mixins contribute is spelled
            # out here. `AleatoryCollection.__init__` builds the same shape
            # for direct origination and tests; the two must agree, and the
            # child's own `sp.cast(self.data, t_collection_storage)` is
            # what makes a drift between them a compile error rather than a
            # runtime surprise on mainnet.
            address = sp.create_contract(
                AleatoryCollection,
                None,
                sp.mutez(0),
                sp.record(
                    administrator=sp.sender,
                    proposed_admin=None,
                    resolver=self.data.resolver,
                    local_minters=sp.set(),
                    provider=params.provider,
                    render_price=quoted,
                    media_due=sp.big_map(),
                    escrowed=sp.mutez(0),
                    code_uri=params.code_uri,
                    code_uri_bytes=params.code_uri_bytes,
                    code_hash=params.code_hash,
                    edition_size=params.edition_size,
                    price=params.price,
                    royalties=params.royalties,
                    params_schema=params.params_schema,
                    token_name=params.token_name,
                    placeholder_uri=params.placeholder_uri,
                    paused=False,
                    retired=False,
                    ledger=sp.big_map(),
                    operators=sp.big_map(),
                    token_metadata=sp.big_map(),
                    metadata=params.metadata,
                    next_token_id=0,
                ),
                # Private (compile-time) data the fa2_lib mixins carry: the
                # ledger flavour and the transfer policy. Must match what
                # `main.Nft` / `OwnerOrOperatorTransfer` set for themselves.
                private_=sp.record(
                    ledger_type="NFT",
                    policy=sp.record(
                        name="owner-or-operator-transfer",
                        supports_transfer=True,
                        supports_operator=True,
                    ),
                ),
            )

            collection_id = self.data.next_collection_id
            self.data.collections[collection_id] = address
            self.data.next_collection_id += 1

            sp.emit(
                sp.record(
                    collection_id=collection_id,
                    address=address,
                    artist=sp.sender,
                    code_uri=params.code_uri,
                    code_hash=params.code_hash,
                    edition_size=params.edition_size,
                ),
                tag="deploy",
            )

        @sp.entrypoint
        def set_deploy_price(self, price):
            """(Admin only) Our fee. Changeable, and it only ever applies
            to deployments made after the change."""
            sp.cast(price, sp.mutez)
            assert sp.amount == sp.mutez(0), "TEZ_NOT_ACCEPTED"
            assert self.is_administrator_(), "NOT_ADMIN"
            self.data.deploy_price = price
            sp.emit(sp.record(price=price), tag="set_deploy_price")

        @sp.entrypoint
        def set_resolver(self, resolver):
            """(Admin only) Which resolver *future* collections are built
            against. Collections already deployed keep the resolver they
            were born with — theirs is fixed, by design."""
            sp.cast(resolver, sp.address)
            assert sp.amount == sp.mutez(0), "TEZ_NOT_ACCEPTED"
            assert self.is_administrator_(), "NOT_ADMIN"
            self.data.resolver = resolver
            sp.emit(sp.record(resolver=resolver), tag="set_resolver")

        @sp.entrypoint
        def set_paused(self, new_state):
            """(Admin only) Stop new deployments. Has no effect on any
            collection already deployed — we have no authority there."""
            sp.cast(new_state, sp.bool)
            assert sp.amount == sp.mutez(0), "TEZ_NOT_ACCEPTED"
            assert self.is_administrator_(), "NOT_ADMIN"
            self.data.paused = new_state
            sp.emit(sp.record(paused=new_state), tag="set_paused")

        @sp.entrypoint
        def set_treasury(self, treasury):
            sp.cast(treasury, sp.address)
            assert sp.amount == sp.mutez(0), "TEZ_NOT_ACCEPTED"
            assert self.is_administrator_(), "NOT_ADMIN"
            self.data.treasury = treasury
            sp.emit(sp.record(treasury=treasury), tag="set_treasury")

        @sp.entrypoint
        def withdraw_fees(self):
            """(Anyone) Sweep accrued fees to the treasury.

            Fees accrue rather than being forwarded during `deploy`, so a
            treasury address that rejects transfers cannot make deploys
            fail. Permissionless because the destination is fixed in
            storage: there is nothing to steal by calling it.
            """
            assert sp.amount == sp.mutez(0), "TEZ_NOT_ACCEPTED"
            amount = self.data.fees_accrued
            assert amount > sp.mutez(0), "NOTHING_TO_WITHDRAW"
            self.data.fees_accrued = sp.mutez(0)
            sp.send(self.data.treasury, amount)
            sp.emit(
                sp.record(to=self.data.treasury, amount=amount),
                tag="withdraw_fees",
            )

        @sp.entrypoint
        def propose_admin(self, new_admin):
            sp.cast(new_admin, sp.address)
            assert sp.amount == sp.mutez(0), "TEZ_NOT_ACCEPTED"
            assert self.is_administrator_(), "NOT_ADMIN"
            self.data.proposed_admin = sp.Some(new_admin)
            sp.emit(sp.record(proposed_admin=new_admin), tag="propose_admin")

        @sp.entrypoint
        def accept_admin(self):
            assert sp.amount == sp.mutez(0), "TEZ_NOT_ACCEPTED"
            assert self.data.proposed_admin == sp.Some(
                sp.sender
            ), "NOT_PROPOSED_ADMIN"
            self.data.administrator = sp.sender
            self.data.proposed_admin = None
            sp.emit(sp.record(new_admin=sp.sender), tag="accept_admin")

        @sp.entrypoint
        def admin_lambda(self, f):
            """(Admin only) Arbitrary transformation of *factory* storage.

            Safe to keep here in a way it would not be on a collection:
            this contract holds no tokens, so there is nothing of anyone
            else's to reach. It cannot change the collection template
            (contract code is immutable) and it cannot touch a deployed
            collection (we hold no authority there).
            """
            assert sp.amount == sp.mutez(0), "TEZ_NOT_ACCEPTED"
            assert self.is_administrator_(), "NOT_ADMIN"
            sp.cast(f, sp.lambda_(t_factory_storage, t_factory_storage))
            self.data = f(self.data)
            sp.emit(sp.record(executed=True), tag="admin_lambda")

        @sp.onchain_view()
        def get_collection(self, collection_id):
            sp.cast(collection_id, sp.nat)
            return self.data.collections.get(
                collection_id, error="NO_COLLECTION"
            )


# === Tests ===

_META = sp.big_map(
    {
        "": sp.bytes("0x74657a6f732d73746f726167653a636f6e74656e74"),
        # {"name":"Aleatory","interfaces":["TZIP-012","TZIP-016"]}
        "content": sp.bytes(
            "0x7b226e616d65223a22416c6561746f7279222c22696e74657266616365"
            "73223a5b22545a49502d303132222c22545a49502d303136225d7d"
        ),
    }
)
_CODE_URI = "ipfs://QmGeneratorCode"
_CODE_URI_B = sp.bytes("0x697066733a2f2f516d47656e657261746f72436f6465")
_PLACEHOLDER = sp.bytes("0x697066733a2f2f516d506c616365686f6c646572")
_IMAGE = sp.bytes("0x697066733a2f2f516d496d616765")
_NAME = sp.bytes("0x5069656365")  # "Piece"
_ROYALTIES = sp.bytes("0x7b7d")  # "{}"
_NONE = sp.bytes("0x")


def _collection_init(artist, resolver, provider, render_price=200_000,
                     price=1_000_000, edition_size=10):
    return sp.record(
        administrator=artist.address,
        resolver=resolver.address,
        provider=provider.address,
        render_price=sp.mutez(render_price),
        code_uri=_CODE_URI,
        code_uri_bytes=_CODE_URI_B,
        code_hash=sp.bytes("0xaa"),
        edition_size=edition_size,
        price=sp.mutez(price),
        royalties=_ROYALTIES,
        params_schema=_NONE,
        token_name=_NAME,
        placeholder_uri=_PLACEHOLDER,
        metadata=_META,
    )


def _setup(scenario, admin, minter, treasury, render_price=200_000,
           deploy_price=100_000):
    resolver = aleatory.AleatoryResolver(
        administrator=admin.address, minters=sp.set([minter.address])
    )
    scenario += resolver
    provider = aleatory.AleatoryProvider(
        operator=admin.address, render_price=sp.mutez(render_price)
    )
    scenario += provider
    factory = aleatory.AleatoryFactory(
        administrator=admin.address,
        treasury=treasury.address,
        deploy_price=sp.mutez(deploy_price),
        resolver=resolver.address,
    )
    scenario += factory
    return resolver, provider, factory


def _deploy_params(provider, price=1_000_000, edition_size=10,
                   max_render_price=1_000_000):
    return sp.record(
        code_uri=_CODE_URI,
        code_uri_bytes=_CODE_URI_B,
        code_hash=sp.bytes("0xaa"),
        edition_size=edition_size,
        price=sp.mutez(price),
        royalties=_ROYALTIES,
        params_schema=_NONE,
        token_name=_NAME,
        placeholder_uri=_PLACEHOLDER,
        provider=provider.address,
        max_render_price=sp.mutez(max_render_price),
        metadata=_META,
    )


@sp.add_test()
def test_deploy_installs_artist_as_admin():
    """One operation, and the artist owns the result outright. Nothing is
    held by the factory and handed over."""
    scenario = sp.test_scenario("Deploy", aleatory)
    admin = sp.test_account("Admin")
    minter = sp.test_account("Minter")
    treasury = sp.test_account("Treasury")
    artist = sp.test_account("Artist")
    resolver, provider, factory = _setup(scenario, admin, minter, treasury)

    factory.deploy(
        _deploy_params(provider), _sender=artist, _amount=sp.mutez(1),
        _valid=False,
    )
    # The artist's ceiling is enforced against the provider's live quote.
    factory.deploy(
        _deploy_params(provider, max_render_price=1),
        _sender=artist,
        _amount=sp.mutez(100_000),
        _valid=False,
    )
    factory.deploy(
        _deploy_params(provider), _sender=artist, _amount=sp.mutez(100_000)
    )
    scenario.verify(factory.data.next_collection_id == 1)
    scenario.verify(factory.data.fees_accrued == sp.mutez(100_000))


@sp.add_test()
def test_buy_mints_immediately_with_placeholder():
    """The token exists when `buy` returns: code, params, royalties and
    owner all written. Only the image is pending."""
    scenario = sp.test_scenario("Buy mints", aleatory)
    admin = sp.test_account("Admin")
    minter = sp.test_account("Minter")
    treasury = sp.test_account("Treasury")
    artist = sp.test_account("Artist")
    alice = sp.test_account("Alice")
    resolver, provider, factory = _setup(scenario, admin, minter, treasury)

    c = aleatory.AleatoryCollection(
        _collection_init(artist, resolver, provider)
    )
    scenario += c

    # Price is the piece plus the render fee.
    c.buy(_NONE, _sender=alice, _amount=sp.mutez(1_000_000), _valid=False)
    c.buy(_NONE, _sender=alice, _amount=sp.mutez(1_200_000))

    scenario.verify(c.data.ledger[0] == alice.address)
    scenario.verify(c.data.next_token_id == 1)
    scenario.verify(
        c.data.token_metadata[0].token_info["artifactUri"] == _CODE_URI_B
    )
    scenario.verify(
        c.data.token_metadata[0].token_info["displayUri"] == _PLACEHOLDER
    )
    # Only the render fee is held; the artist was paid inline.
    scenario.verify(c.data.escrowed == sp.mutez(200_000))
    scenario.verify(c.balance == sp.mutez(200_000))


@sp.add_test()
def test_media_written_once_and_paid_on_delivery():
    scenario = sp.test_scenario("Set media", aleatory)
    admin = sp.test_account("Admin")
    minter = sp.test_account("Minter")
    treasury = sp.test_account("Treasury")
    artist = sp.test_account("Artist")
    alice = sp.test_account("Alice")
    resolver, provider, factory = _setup(scenario, admin, minter, treasury)

    c = aleatory.AleatoryCollection(
        _collection_init(artist, resolver, provider)
    )
    scenario += c
    c.buy(_NONE, _sender=alice, _amount=sp.mutez(1_200_000))

    media = sp.record(token_id=0, display_uri=_IMAGE, thumbnail_uri=_IMAGE)

    # Not the artist, not the owner, not a stranger.
    c.set_media(media, _sender=artist, _valid=False)
    c.set_media(media, _sender=alice, _valid=False)

    c.set_media(media, _sender=minter)
    scenario.verify(
        c.data.token_metadata[0].token_info["displayUri"] == _IMAGE
    )
    # Escrow released on delivery, not before.
    scenario.verify(c.data.escrowed == sp.mutez(0))
    scenario.verify(c.balance == sp.mutez(0))

    # Write-once: no second bite at an existing token.
    c.set_media(media, _sender=minter, _valid=False)


@sp.add_test()
def test_media_cannot_touch_anything_else():
    """`set_media` is the only entrypoint that modifies an existing token,
    and it can reach exactly two fields of one token."""
    scenario = sp.test_scenario("Media scope", aleatory)
    admin = sp.test_account("Admin")
    minter = sp.test_account("Minter")
    treasury = sp.test_account("Treasury")
    artist = sp.test_account("Artist")
    alice = sp.test_account("Alice")
    bob = sp.test_account("Bob")
    resolver, provider, factory = _setup(scenario, admin, minter, treasury)

    c = aleatory.AleatoryCollection(
        _collection_init(artist, resolver, provider)
    )
    scenario += c
    c.buy(sp.bytes("0x7b2264223a317d"), _sender=alice,
          _amount=sp.mutez(1_200_000))
    c.set_media(
        sp.record(token_id=0, display_uri=_IMAGE, thumbnail_uri=_IMAGE),
        _sender=minter,
    )

    info = c.data.token_metadata[0].token_info
    scenario.verify(info["artifactUri"] == _CODE_URI_B)
    scenario.verify(info["aleaParams"] == sp.bytes("0x7b2264223a317d"))
    scenario.verify(info["royalties"] == _ROYALTIES)
    scenario.verify(c.data.ledger[0] == alice.address)

    # Owner still controls the token; nobody else can move it.
    c.transfer(
        [sp.record(from_=alice.address,
                   txs=[sp.record(to_=bob.address, amount=1, token_id=0)])],
        _sender=minter,
        _valid=False,
    )
    c.transfer(
        [sp.record(from_=alice.address,
                   txs=[sp.record(to_=bob.address, amount=1, token_id=0)])],
        _sender=alice,
    )
    scenario.verify(c.data.ledger[0] == bob.address)


@sp.add_test()
def test_provider_switch_pays_whoever_delivers():
    """A provider that vanishes cannot strand a collection: the artist
    switches, and the fee held for unrendered pieces follows the work."""
    scenario = sp.test_scenario("Provider switch", aleatory)
    admin = sp.test_account("Admin")
    minter = sp.test_account("Minter")
    treasury = sp.test_account("Treasury")
    artist = sp.test_account("Artist")
    alice = sp.test_account("Alice")
    rival_op = sp.test_account("RivalOperator")
    rival_key = sp.test_account("RivalKey")
    resolver, provider, factory = _setup(scenario, admin, minter, treasury)

    rival = aleatory.AleatoryProvider(
        operator=rival_op.address, render_price=sp.mutez(50_000)
    )
    scenario += rival

    c = aleatory.AleatoryCollection(
        _collection_init(artist, resolver, provider)
    )
    scenario += c
    c.buy(_NONE, _sender=alice, _amount=sp.mutez(1_200_000))

    # Original provider is gone. The artist switches; only they may.
    c.set_provider(
        sp.record(provider=rival.address, max_price=sp.mutez(100_000)),
        _sender=alice,
        _valid=False,
    )
    c.set_provider(
        sp.record(provider=rival.address, max_price=sp.mutez(100_000)),
        _sender=artist,
    )
    scenario.verify(c.data.render_price == sp.mutez(50_000))

    # New provider delivers the old piece and collects the old fee.
    c.set_local_minter(
        sp.record(minter=rival_key.address, allowed=True), _sender=artist
    )
    c.set_media(
        sp.record(token_id=0, display_uri=_IMAGE, thumbnail_uri=_IMAGE),
        _sender=rival_key,
    )
    scenario.verify(c.data.escrowed == sp.mutez(0))

    # New sales are at the new render price.
    c.buy(_NONE, _sender=alice, _amount=sp.mutez(1_200_000), _valid=False)
    c.buy(_NONE, _sender=alice, _amount=sp.mutez(1_050_000))


@sp.add_test()
def test_resolver_rotation_and_local_override():
    """One flip disables a leaked key everywhere; the artist's override
    means a dead resolver cannot strand them."""
    scenario = sp.test_scenario("Resolver", aleatory)
    admin = sp.test_account("Admin")
    minter = sp.test_account("Minter")
    treasury = sp.test_account("Treasury")
    artist = sp.test_account("Artist")
    alice = sp.test_account("Alice")
    rescue = sp.test_account("Rescue")
    resolver, provider, factory = _setup(scenario, admin, minter, treasury)

    c = aleatory.AleatoryCollection(
        _collection_init(artist, resolver, provider)
    )
    scenario += c
    c.buy(_NONE, _sender=alice, _amount=sp.mutez(1_200_000))

    media = sp.record(token_id=0, display_uri=_IMAGE, thumbnail_uri=_IMAGE)
    resolver.remove_minter(minter.address, _sender=admin)
    c.set_media(media, _sender=minter, _valid=False)

    c.set_local_minter(
        sp.record(minter=rescue.address, allowed=True), _sender=artist
    )
    c.set_media(media, _sender=rescue)
    scenario.verify(
        c.data.token_metadata[0].token_info["displayUri"] == _IMAGE
    )


@sp.add_test()
def test_edition_cap_pause_and_retire():
    scenario = sp.test_scenario("Supply controls", aleatory)
    admin = sp.test_account("Admin")
    minter = sp.test_account("Minter")
    treasury = sp.test_account("Treasury")
    artist = sp.test_account("Artist")
    alice = sp.test_account("Alice")
    resolver, provider, factory = _setup(scenario, admin, minter, treasury)

    c = aleatory.AleatoryCollection(
        _collection_init(artist, resolver, provider, edition_size=2)
    )
    scenario += c

    c.set_paused(True, _sender=alice, _valid=False)
    c.set_paused(True, _sender=artist)
    c.buy(_NONE, _sender=alice, _amount=sp.mutez(1_200_000), _valid=False)
    c.set_paused(False, _sender=artist)

    c.buy(_NONE, _sender=alice, _amount=sp.mutez(1_200_000))
    c.buy(_NONE, _sender=alice, _amount=sp.mutez(1_200_000))
    c.buy(_NONE, _sender=alice, _amount=sp.mutez(1_200_000), _valid=False)

    c.retire(_sender=alice, _valid=False)
    c.retire(_sender=artist)
    c.set_price(sp.mutez(1), _sender=artist, _valid=False)

    # Retiring never blocks delivery of pieces already sold.
    c.set_media(
        sp.record(token_id=0, display_uri=_IMAGE, thumbnail_uri=_IMAGE),
        _sender=minter,
    )


@sp.add_test()
def test_factory_has_no_authority_over_collections():
    """Deploying is the end of our involvement."""
    scenario = sp.test_scenario("No retained authority", aleatory)
    admin = sp.test_account("Admin")
    minter = sp.test_account("Minter")
    treasury = sp.test_account("Treasury")
    artist = sp.test_account("Artist")
    resolver, provider, factory = _setup(scenario, admin, minter, treasury)

    c = aleatory.AleatoryCollection(
        _collection_init(artist, resolver, provider)
    )
    scenario += c

    c.set_paused(True, _sender=admin, _valid=False)
    c.set_price(sp.mutez(1), _sender=admin, _valid=False)
    c.retire(_sender=admin, _valid=False)
    c.set_provider(
        sp.record(provider=provider.address, max_price=sp.mutez(1_000_000)),
        _sender=admin,
        _valid=False,
    )
    c.set_paused(True, _sender=artist)


@sp.add_test()
def test_factory_admin_lambda_and_fees():
    scenario = sp.test_scenario("Factory admin", aleatory)
    admin = sp.test_account("Admin")
    minter = sp.test_account("Minter")
    treasury = sp.test_account("Treasury")
    artist = sp.test_account("Artist")
    resolver, provider, factory = _setup(scenario, admin, minter, treasury)

    factory.deploy(
        _deploy_params(provider), _sender=artist, _amount=sp.mutez(100_000)
    )
    factory.withdraw_fees(_sender=artist)
    scenario.verify(factory.data.fees_accrued == sp.mutez(0))
    factory.withdraw_fees(_sender=artist, _valid=False)

    factory.admin_lambda(
        aleatory.identity_lambda, _sender=artist, _valid=False
    )
    factory.admin_lambda(aleatory.identity_lambda, _sender=admin)
