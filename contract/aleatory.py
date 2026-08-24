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
        provider_agent=sp.address,
        render_gas=sp.mutez,
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
        # Name prefix. Each token is named "<token_name> #<token_id + 1>",
        # composed on chain at mint — token ids are 0-based, displayed
        # edition numbers are 1-based, which is the convention everywhere.
        token_name=sp.bytes,
        placeholder_uri=sp.bytes,
        start_paused=sp.bool,
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
        provider_agent=sp.address,
        render_gas=sp.mutez,
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

    def nat_to_bytes(n):
        """Decimal ASCII for a nat: 0 -> "0", 42 -> "42".

        There is no NAT_TO_STRING in Michelson. This is the standard
        workaround — divide by ten, look the remainder up in a digit table,
        prepend. Bounded by the number of digits, so for token ids and
        royalty shares it is a handful of iterations.
        """
        sp.cast(n, sp.nat)
        # ASCII "0123456789", indexed by digit value. A local rather than a
        # module constant: sp.module only carries types and functions.
        digits = sp.bytes("0x30313233343536373839")
        out = sp.bytes("0x")
        if n == 0:
            out = sp.slice(0, 1, digits).unwrap_some()
        else:
            rest = n
            while rest > 0:
                digit = sp.mod(rest, 10)
                out = sp.concat(
                    [sp.slice(digit, 1, digits).unwrap_some(), out]
                )
                rest = sp.fst(sp.ediv(rest, 10).unwrap_some())
        return out

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
            self.data.provider_agent = init.provider_agent
            self.data.render_gas = init.render_gas
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
            self.data.paused = init.start_paused

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
        def set_edition_size(self, new_size):
            """(Artist only) Shrink the edition, or close it.

            Never grows: there is no path in this contract that raises an
            edition size, because that would rewrite what collectors
            bought into. Shrinking only makes existing pieces scarcer, so
            no holder is harmed by it.

            Setting the size to the number already minted closes the
            edition permanently — that is what replaces a separate
            `retire` entrypoint. It is one-way only in the sense that
            nothing can grow again afterwards.

            `0` means open edition, and it is *larger* than any finite
            size. So open -> finite is a valid reduction, finite -> open
            is never allowed, and a naive `new <= current` comparison
            would get both backwards.
            """
            sp.cast(new_size, sp.nat)
            assert sp.amount == sp.mutez(0), "TEZ_NOT_ACCEPTED"
            assert self.is_artist_(), "NOT_ARTIST"
            assert new_size != 0, "CANNOT_REOPEN"
            assert new_size >= self.data.next_token_id, "BELOW_MINTED"
            if self.data.edition_size != 0:
                assert new_size <= self.data.edition_size, "CANNOT_GROW"
            self.data.edition_size = new_size
            sp.emit(
                sp.record(
                    edition_size=new_size, minted=self.data.next_token_id
                ),
                tag="set_edition_size",
            )

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
                "get_render_gas", provider, (), sp.mutez
            ).unwrap_some(error="NO_PROVIDER_VIEW")
            agent = sp.view(
                "get_agent", provider, (), sp.address
            ).unwrap_some(error="NO_PROVIDER_VIEW")
            assert quoted <= max_price, "PRICE_ABOVE_MAX"
            self.data.provider = provider
            self.data.provider_agent = agent
            self.data.render_gas = quoted
            sp.emit(
                sp.record(
                    provider=provider, agent=agent, render_gas=quoted
                ),
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
            Code, parameters, royalties, owner and name are all written
            now; the only thing missing is a raster image, and until a
            provider supplies one the token shows `placeholder_uri`. An
            unrevealed piece is a complete artwork with a pending
            thumbnail, not a promise of a future token — which is why
            there is nothing to strand, nothing to refund, and nothing a
            failed provider can take away.

            THIS OPERATION'S HASH IS THE SEED SOURCE, and it is also the
            operation that mints, so the binding needs no extra record: a
            token's seed derives from the hash of the operation that
            created it.

            It does *not* make grinding expensive — the hash covers
            sender-controlled fields, so candidates are enumerated offline
            and only the chosen one is injected. Documented tradeoff of an
            op-hash seed, accepted rather than engineered around.

            `params` is the canonical-JSON encoding of the collector's
            resolved parameter values (params.md §3), empty when the
            generator declares none. Written into the token here, by their
            own signature, so nobody downstream can alter what they chose.

            Payment is `price + render_gas`, split in this same operation:
            the price to the artist, the render gas to the provider. The
            contract holds nothing when it returns — no escrow, no
            balance, no withdraw entrypoint.
            """
            sp.cast(params, sp.bytes)
            assert not self.data.paused, "PAUSED"
            assert (
                sp.amount == self.data.price + self.data.render_gas
            ), "WRONG_PRICE"
            # edition_size 0 is an open edition.
            assert (
                self.data.edition_size == 0
                or self.data.next_token_id < self.data.edition_size
            ), "SOLD_OUT"

            token_id = self.data.next_token_id

            # Composed here from immutable collection state plus what the
            # collector chose. Nothing about a token's metadata is ever
            # supplied by a backend, so there is no arbitrary-URI hole to
            # defend: the only fields any provider may write are the two
            # image URIs, once, in `set_media`.
            #
            # Token ids are 0-based; displayed edition numbers are
            # 1-based, so token 0 is "<name> #1".
            token_info = sp.cast(
                {
                    "decimals": sp.bytes("0x30"),  # "0"
                    "name": sp.concat(
                        [
                            self.data.token_name,
                            sp.bytes("0x2023"),  # " #"
                            nat_to_bytes(token_id + 1),
                        ]
                    ),
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

            # Paid inline, both of them. A bad artist or provider address
            # breaks that collection's own sales and nobody else's.
            if self.data.render_gas > sp.mutez(0):
                sp.send(self.data.provider_agent, self.data.render_gas)
            if self.data.price > sp.mutez(0):
                sp.send(self.data.administrator, self.data.price)

            sp.emit(
                sp.record(
                    token_id=token_id,
                    buyer=sp.sender,
                    params=params,
                    paid=sp.amount,
                    render_gas=self.data.render_gas,
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
            allowed = who == self.data.provider_agent
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

            The only entrypoint in this contract that modifies an existing
            token, and deliberately the narrowest one that can do the job:
            two URI fields, on a token that has no image yet, never again
            afterwards. It cannot touch the artwork, the parameters, the
            royalties, the owner, or any other token.

            Write-once is enforced by comparing against the collection's
            `placeholder_uri` rather than by keeping a separate flag —
            which is the same rule providers use off chain to find pending
            work, so there is exactly one definition of "needs rendering"
            and no state that can disagree with itself.

            No payment happens here. The provider was paid at `buy`. If
            one takes the gas and never delivers, the artist switches
            provider and stops paying them; the backlog is settled between
            artist and provider, off chain. Bounded, because a stuck piece
            is missing a thumbnail, not an artwork.

            Writing an image that does not match the piece is possible and
            not preventable on chain. It is detectable by anyone: the seed
            comes from the mint operation, the parameters are on the
            token, and the code is immutable, so the correct image is
            reproducible. Detection and key rotation, not a guarantee we
            cannot make.
            """
            sp.cast(token_id, sp.nat)
            sp.cast(display_uri, sp.bytes)
            sp.cast(thumbnail_uri, sp.bytes)
            assert sp.amount == sp.mutez(0), "TEZ_NOT_ACCEPTED"
            assert self.may_write_media_(sp.sender), "NOT_AUTHORISED"
            assert sp.len(display_uri) > 0, "EMPTY_DISPLAY_URI"
            assert display_uri != self.data.placeholder_uri, "IS_PLACEHOLDER"

            token = self.data.token_metadata.get(
                token_id, error="NO_TOKEN"
            )
            assert (
                token.token_info["displayUri"] == self.data.placeholder_uri
            ), "ALREADY_RENDERED"

            token.token_info["displayUri"] = display_uri
            token.token_info["thumbnailUri"] = thumbnail_uri
            self.data.token_metadata[token_id] = token

            sp.emit(
                sp.record(
                    token_id=token_id,
                    display_uri=display_uri,
                    renderer=sp.sender,
                ),
                tag="set_media",
            )

        # --- views ---

        @sp.onchain_view()
        def needs_media(self, token_id):
            """Whether a piece is still awaiting its image — the same rule
            providers use off chain, so the two can never disagree."""
            sp.cast(token_id, sp.nat)
            token = self.data.token_metadata.get(token_id, error="NO_TOKEN")
            return (
                token.token_info["displayUri"] == self.data.placeholder_uri
            )

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
                render_gas=self.data.render_gas,
                provider=self.data.provider,
                provider_agent=self.data.provider_agent,
                placeholder_uri=self.data.placeholder_uri,
                paused=self.data.paused,
            )


    # ---------------------------------------------------------------
    # Provider
    # ---------------------------------------------------------------

    class AleatoryProvider(sp.Contract):
        """A render provider's price, on chain.

        This contract is not required — anything exposing `get_render_gas`
        and `get_agent` views is a provider, and those two views are the
        whole membership test. It is here as the reference implementation so that
        "run your own renderer and sell the service" is a deploy, not a
        negotiation.

        Collections snapshot the quote when the artist picks the provider,
        so a price change never affects a collection that already agreed to
        an older one until its artist re-snapshots.
        """

        def __init__(self, operator, agent, render_gas, metadata):
            self.data.operator = operator
            # The address that actually does the work: it calls `set_media`
            # and it receives the render gas. An implicit account, because a
            # KT1 with no default entrypoint cannot be sent tez — and because
            # this is a hot key that gets rotated, while `operator` is the
            # cold one that rotates it.
            self.data.agent = agent
            self.data.render_gas = render_gas
            # TZIP-16 metadata: name, and the push endpoint a mint UI can
            # ping for latency. Deliberately here rather than in a storage
            # field with its own entrypoint — endpoints rot, metadata is
            # free to update, and a provider who advertises nothing still
            # works by polling the chain.
            self.data.metadata = sp.cast(
                metadata, sp.big_map[sp.string, sp.bytes]
            )

        @sp.entrypoint
        def set_render_gas(self, price):
            sp.cast(price, sp.mutez)
            assert sp.amount == sp.mutez(0), "TEZ_NOT_ACCEPTED"
            assert sp.sender == self.data.operator, "NOT_OPERATOR"
            self.data.render_gas = price
            sp.emit(sp.record(price=price), tag="set_render_gas")

        @sp.entrypoint
        def set_agent(self, agent):
            """(Operator only) Rotate the working key. Collections pick the
            new one up when their artist re-snapshots the provider."""
            sp.cast(agent, sp.address)
            assert sp.amount == sp.mutez(0), "TEZ_NOT_ACCEPTED"
            assert sp.sender == self.data.operator, "NOT_OPERATOR"
            self.data.agent = agent
            sp.emit(sp.record(agent=agent), tag="set_agent")

        @sp.entrypoint
        def set_metadata(self, key, value):
            sp.cast(key, sp.string)
            sp.cast(value, sp.bytes)
            assert sp.amount == sp.mutez(0), "TEZ_NOT_ACCEPTED"
            assert sp.sender == self.data.operator, "NOT_OPERATOR"
            self.data.metadata[key] = value

        @sp.onchain_view()
        def get_render_gas(self):
            return self.data.render_gas

        @sp.onchain_view()
        def get_agent(self):
            return self.data.agent

        @sp.onchain_view()
        def get_operator(self):
            return self.data.operator

    # ---------------------------------------------------------------
    # Registry
    # ---------------------------------------------------------------

    class AleatoryRegistry(sp.Contract):
        """The list of render providers. Nobody controls it.

        Registration is permissionless and free. There is no fee, no
        allowlist, and no admin who can remove an entry — this is
        deliberately not a gate anyone holds. Deploying a provider contract
        already costs origination burn, which is a real floor against bulk
        junk, and a provider that has never delivered anything sorts to the
        bottom of a ranking computed from chain events rather than from
        anything asserted here.

        The registry exists so a UI can enumerate providers without asking
        us. It makes no claim about whether any of them are any good; that
        is what the measured ranking is for.
        """

        def __init__(self):
            self.data.providers = sp.cast(
                sp.big_map(), sp.big_map[sp.address, sp.timestamp]
            )
            self.data.count = 0

        @sp.entrypoint
        def register(self, provider):
            """(Anyone) List a provider contract.

            Checks the two views that define a provider, so an entry that
            cannot possibly be used never lands in the list. That is a
            type check, not an endorsement.
            """
            sp.cast(provider, sp.address)
            assert sp.amount == sp.mutez(0), "TEZ_NOT_ACCEPTED"
            assert not self.data.providers.contains(provider), "ALREADY"
            gas = sp.view(
                "get_render_gas", provider, (), sp.mutez
            ).unwrap_some(error="NOT_A_PROVIDER")
            agent = sp.view(
                "get_agent", provider, (), sp.address
            ).unwrap_some(error="NOT_A_PROVIDER")
            self.data.providers[provider] = sp.now
            self.data.count += 1
            sp.emit(
                sp.record(provider=provider, agent=agent, render_gas=gas),
                tag="register",
            )

        @sp.entrypoint
        def deregister(self, provider):
            """(The provider's own operator) Remove an entry.

            Only the operator of that provider contract can do this, which
            is checked by asking the contract itself. Nobody else — not us,
            not an artist, not another provider — can delist anyone.
            """
            sp.cast(provider, sp.address)
            assert sp.amount == sp.mutez(0), "TEZ_NOT_ACCEPTED"
            assert self.data.providers.contains(provider), "NOT_REGISTERED"
            operator = sp.view(
                "get_operator", provider, (), sp.address
            ).unwrap_some(error="NOT_A_PROVIDER")
            assert sp.sender == operator, "NOT_OPERATOR"
            del self.data.providers[provider]
            self.data.count = sp.as_nat(self.data.count - 1)
            sp.emit(sp.record(provider=provider), tag="deregister")

        @sp.onchain_view()
        def is_registered(self, provider):
            sp.cast(provider, sp.address)
            return self.data.providers.contains(provider)

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
                    start_paused=sp.bool,
                    provider=sp.address,
                    max_render_gas=sp.mutez,
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
                "get_render_gas", params.provider, (), sp.mutez
            ).unwrap_some(error="NO_PROVIDER_VIEW")
            agent = sp.view(
                "get_agent", params.provider, (), sp.address
            ).unwrap_some(error="NO_PROVIDER_VIEW")
            assert quoted <= params.max_render_gas, "PRICE_ABOVE_MAX"

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
                    provider_agent=agent,
                    render_gas=quoted,
                    code_uri=params.code_uri,
                    code_uri_bytes=params.code_uri_bytes,
                    code_hash=params.code_hash,
                    edition_size=params.edition_size,
                    price=params.price,
                    royalties=params.royalties,
                    params_schema=params.params_schema,
                    token_name=params.token_name,
                    placeholder_uri=params.placeholder_uri,
                    paused=params.start_paused,
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

_PRICE = 1_000_000
_GAS = 200_000
_TOTAL = _PRICE + _GAS


def _collection_init(artist, resolver, provider, minter, render_gas=_GAS,
                     price=_PRICE, edition_size=10, start_paused=False,
                     agent=None):
    return sp.record(
        administrator=artist.address,
        resolver=resolver.address,
        provider=provider.address,
        provider_agent=(minter if agent is None else agent).address,
        render_gas=sp.mutez(render_gas),
        code_uri=_CODE_URI,
        code_uri_bytes=_CODE_URI_B,
        code_hash=sp.bytes("0xaa"),
        edition_size=edition_size,
        price=sp.mutez(price),
        royalties=_ROYALTIES,
        params_schema=_NONE,
        token_name=_NAME,
        placeholder_uri=_PLACEHOLDER,
        start_paused=start_paused,
        metadata=_META,
    )


def _setup(scenario, admin, minter, treasury, render_gas=_GAS):
    resolver = aleatory.AleatoryResolver(
        administrator=admin.address, minters=sp.set([minter.address])
    )
    scenario += resolver
    provider = aleatory.AleatoryProvider(
        operator=admin.address,
        agent=minter.address,
        render_gas=sp.mutez(render_gas),
        metadata=_META,
    )
    scenario += provider
    factory = aleatory.AleatoryFactory(
        administrator=admin.address,
        treasury=treasury.address,
        deploy_price=sp.mutez(0),
        resolver=resolver.address,
    )
    scenario += factory
    return resolver, provider, factory


def _collection(scenario, artist, resolver, provider, minter, **kw):
    c = aleatory.AleatoryCollection(
        _collection_init(artist, resolver, provider, minter, **kw)
    )
    scenario += c
    return c


def _deploy_params(provider, price=_PRICE, edition_size=10,
                   max_render_gas=1_000_000, start_paused=False):
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
        start_paused=start_paused,
        provider=provider.address,
        max_render_gas=sp.mutez(max_render_gas),
        metadata=_META,
    )


def _media(token_id=0, uri=_IMAGE):
    return sp.record(
        token_id=token_id, display_uri=uri, thumbnail_uri=uri
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

    # The artist's ceiling is enforced against the provider's live quote.
    factory.deploy(
        _deploy_params(provider, max_render_gas=1),
        _sender=artist,
        _valid=False,
    )
    factory.deploy(_deploy_params(provider), _sender=artist)
    scenario.verify(factory.data.next_collection_id == 1)
    # No deploy fee: the artist pays their own origination burn and gas.
    scenario.verify(factory.data.fees_accrued == sp.mutez(0))


@sp.add_test()
def test_buy_mints_immediately_with_placeholder():
    """The token exists when `buy` returns: code, params, royalties, owner
    and name all written. Only the image is pending."""
    scenario = sp.test_scenario("Buy mints", aleatory)
    admin = sp.test_account("Admin")
    minter = sp.test_account("Minter")
    treasury = sp.test_account("Treasury")
    artist = sp.test_account("Artist")
    alice = sp.test_account("Alice")
    resolver, provider, factory = _setup(scenario, admin, minter, treasury)
    c = _collection(scenario, artist, resolver, provider, minter)

    # Price is the piece plus the render gas — neither alone is enough.
    c.buy(_NONE, _sender=alice, _amount=sp.mutez(_PRICE), _valid=False)
    c.buy(_NONE, _sender=alice, _amount=sp.mutez(_TOTAL))

    scenario.verify(c.data.ledger[0] == alice.address)
    scenario.verify(c.data.next_token_id == 1)
    info = c.data.token_metadata[0].token_info
    scenario.verify(info["artifactUri"] == _CODE_URI_B)
    scenario.verify(info["displayUri"] == _PLACEHOLDER)
    scenario.verify(info["royalties"] == _ROYALTIES)
    # Token ids are 0-based, displayed edition numbers are 1-based.
    scenario.verify(info["name"] == sp.bytes("0x5069656365202331"))  # Piece #1
    # Nothing held: both legs paid inline.
    scenario.verify(c.balance == sp.mutez(0))


@sp.add_test()
def test_token_names_are_one_based():
    """token_id 0 is "#1". The nat-to-decimal helper has to carry past a
    digit boundary, so check across ten."""
    scenario = sp.test_scenario("Token names", aleatory)
    admin = sp.test_account("Admin")
    minter = sp.test_account("Minter")
    treasury = sp.test_account("Treasury")
    artist = sp.test_account("Artist")
    alice = sp.test_account("Alice")
    resolver, provider, factory = _setup(scenario, admin, minter, treasury)
    c = _collection(scenario, artist, resolver, provider, minter, edition_size=0)

    for _ in range(10):
        c.buy(_NONE, _sender=alice, _amount=sp.mutez(_TOTAL))

    scenario.verify(
        c.data.token_metadata[0].token_info["name"]
        == sp.bytes("0x5069656365202331")  # Piece #1
    )
    scenario.verify(
        c.data.token_metadata[8].token_info["name"]
        == sp.bytes("0x5069656365202339")  # Piece #9
    )
    # Two digits — the carry case.
    scenario.verify(
        c.data.token_metadata[9].token_info["name"]
        == sp.bytes("0x506965636520233130")  # Piece #10
    )


@sp.add_test()
def test_start_paused():
    """Deploy, check, announce, then open."""
    scenario = sp.test_scenario("Start paused", aleatory)
    admin = sp.test_account("Admin")
    minter = sp.test_account("Minter")
    treasury = sp.test_account("Treasury")
    artist = sp.test_account("Artist")
    alice = sp.test_account("Alice")
    resolver, provider, factory = _setup(scenario, admin, minter, treasury)
    c = _collection(scenario, artist, resolver, provider, minter, start_paused=True)

    c.buy(_NONE, _sender=alice, _amount=sp.mutez(_TOTAL), _valid=False)
    c.set_paused(False, _sender=alice, _valid=False)
    c.set_paused(False, _sender=artist)
    c.buy(_NONE, _sender=alice, _amount=sp.mutez(_TOTAL))


@sp.add_test()
def test_media_written_once():
    scenario = sp.test_scenario("Set media", aleatory)
    admin = sp.test_account("Admin")
    minter = sp.test_account("Minter")
    treasury = sp.test_account("Treasury")
    artist = sp.test_account("Artist")
    alice = sp.test_account("Alice")
    resolver, provider, factory = _setup(scenario, admin, minter, treasury)
    c = _collection(scenario, artist, resolver, provider, minter)
    c.buy(_NONE, _sender=alice, _amount=sp.mutez(_TOTAL))

    # Not the artist, not the owner, not a stranger.
    c.set_media(_media(), _sender=artist, _valid=False)
    c.set_media(_media(), _sender=alice, _valid=False)
    # Never the placeholder itself — that would leave it looking pending.
    c.set_media(_media(uri=_PLACEHOLDER), _sender=minter, _valid=False)

    c.set_media(_media(), _sender=minter)
    scenario.verify(
        c.data.token_metadata[0].token_info["displayUri"] == _IMAGE
    )

    # Write-once, and it is the placeholder comparison enforcing it.
    c.set_media(_media(uri=sp.bytes("0x6f74686572")), _sender=minter,
                _valid=False)


@sp.add_test()
def test_media_cannot_touch_anything_else():
    """`set_media` reaches two fields of one token and nothing more."""
    scenario = sp.test_scenario("Media scope", aleatory)
    admin = sp.test_account("Admin")
    minter = sp.test_account("Minter")
    treasury = sp.test_account("Treasury")
    artist = sp.test_account("Artist")
    alice = sp.test_account("Alice")
    bob = sp.test_account("Bob")
    resolver, provider, factory = _setup(scenario, admin, minter, treasury)
    c = _collection(scenario, artist, resolver, provider, minter)

    params = sp.bytes("0x7b2264223a317d")  # {"d":1}
    c.buy(params, _sender=alice, _amount=sp.mutez(_TOTAL))
    c.buy(_NONE, _sender=alice, _amount=sp.mutez(_TOTAL))
    c.set_media(_media(), _sender=minter)

    info = c.data.token_metadata[0].token_info
    scenario.verify(info["artifactUri"] == _CODE_URI_B)
    scenario.verify(info["aleaParams"] == params)
    scenario.verify(info["royalties"] == _ROYALTIES)
    scenario.verify(c.data.ledger[0] == alice.address)
    # The neighbouring token is untouched.
    scenario.verify(
        c.data.token_metadata[1].token_info["displayUri"] == _PLACEHOLDER
    )

    # Owner still controls the token; the renderer cannot move it.
    tx = [
        sp.record(
            from_=alice.address,
            txs=[sp.record(to_=bob.address, amount=1, token_id=0)],
        )
    ]
    c.transfer(tx, _sender=minter, _valid=False)
    c.transfer(tx, _sender=alice)
    scenario.verify(c.data.ledger[0] == bob.address)


@sp.add_test()
def test_edition_size_shrinks_never_grows():
    scenario = sp.test_scenario("Edition size", aleatory)
    admin = sp.test_account("Admin")
    minter = sp.test_account("Minter")
    treasury = sp.test_account("Treasury")
    artist = sp.test_account("Artist")
    alice = sp.test_account("Alice")
    resolver, provider, factory = _setup(scenario, admin, minter, treasury)
    c = _collection(scenario, artist, resolver, provider, minter, edition_size=10)

    c.buy(_NONE, _sender=alice, _amount=sp.mutez(_TOTAL))
    c.buy(_NONE, _sender=alice, _amount=sp.mutez(_TOTAL))

    c.set_edition_size(5, _sender=alice, _valid=False)
    c.set_edition_size(20, _sender=artist, _valid=False)   # never grows
    c.set_edition_size(0, _sender=artist, _valid=False)    # never reopens
    c.set_edition_size(1, _sender=artist, _valid=False)    # below minted
    c.set_edition_size(5, _sender=artist)
    scenario.verify(c.data.edition_size == 5)

    # Closing is setting it to what is already minted.
    c.set_edition_size(2, _sender=artist)
    c.buy(_NONE, _sender=alice, _amount=sp.mutez(_TOTAL), _valid=False)

    # Pieces already sold are still renderable after closing.
    c.set_media(_media(), _sender=minter)


@sp.add_test()
def test_open_edition_can_be_closed():
    """0 is larger than any finite size, so open -> finite is a reduction
    and a naive comparison would reject it."""
    scenario = sp.test_scenario("Open edition", aleatory)
    admin = sp.test_account("Admin")
    minter = sp.test_account("Minter")
    treasury = sp.test_account("Treasury")
    artist = sp.test_account("Artist")
    alice = sp.test_account("Alice")
    resolver, provider, factory = _setup(scenario, admin, minter, treasury)
    c = _collection(scenario, artist, resolver, provider, minter, edition_size=0)

    for _ in range(3):
        c.buy(_NONE, _sender=alice, _amount=sp.mutez(_TOTAL))
    scenario.verify(c.data.next_token_id == 3)

    c.set_edition_size(2, _sender=artist, _valid=False)  # below minted
    c.set_edition_size(4, _sender=artist)
    c.buy(_NONE, _sender=alice, _amount=sp.mutez(_TOTAL))
    c.buy(_NONE, _sender=alice, _amount=sp.mutez(_TOTAL), _valid=False)


@sp.add_test()
def test_provider_switch():
    """A provider that vanishes cannot strand a collection."""
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
        operator=rival_op.address,
        agent=rival_key.address,
        render_gas=sp.mutez(50_000),
        metadata=_META,
    )
    scenario += rival

    c = _collection(scenario, artist, resolver, provider, minter)
    c.buy(_NONE, _sender=alice, _amount=sp.mutez(_TOTAL))

    switch = sp.record(provider=rival.address, max_price=sp.mutez(100_000))
    c.set_provider(switch, _sender=alice, _valid=False)
    c.set_provider(switch, _sender=artist)
    scenario.verify(c.data.render_gas == sp.mutez(50_000))

    # New provider renders the piece the old one never did — authorised
    # by the snapshot itself, with no local override needed.
    c.set_media(_media(), _sender=rival_key)

    # New sales are at the new render gas.
    c.buy(_NONE, _sender=alice, _amount=sp.mutez(_TOTAL), _valid=False)
    c.buy(_NONE, _sender=alice, _amount=sp.mutez(_PRICE + 50_000))


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
    other_agent = sp.test_account("OtherAgent")
    resolver, provider, factory = _setup(scenario, admin, minter, treasury)
    # The collection's own provider agent is someone else, so `minter` is
    # authorised solely by the resolver — which is what this test is about.
    c = _collection(
        scenario, artist, resolver, provider, minter, agent=other_agent
    )
    c.buy(_NONE, _sender=alice, _amount=sp.mutez(_TOTAL))

    scenario.verify(c.data.provider_agent == other_agent.address)
    resolver.remove_minter(minter.address, _sender=admin)
    c.set_media(_media(), _sender=minter, _valid=False)

    c.set_local_minter(
        sp.record(minter=rescue.address, allowed=True), _sender=alice,
        _valid=False,
    )
    c.set_local_minter(
        sp.record(minter=rescue.address, allowed=True), _sender=artist
    )
    c.set_media(_media(), _sender=rescue)
    scenario.verify(
        c.data.token_metadata[0].token_info["displayUri"] == _IMAGE
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
    c = _collection(scenario, artist, resolver, provider, minter)

    c.set_paused(True, _sender=admin, _valid=False)
    c.set_price(sp.mutez(1), _sender=admin, _valid=False)
    c.set_edition_size(1, _sender=admin, _valid=False)
    c.set_provider(
        sp.record(provider=provider.address, max_price=sp.mutez(1_000_000)),
        _sender=admin,
        _valid=False,
    )
    c.set_paused(True, _sender=artist)


@sp.add_test()
def test_factory_admin():
    scenario = sp.test_scenario("Factory admin", aleatory)
    admin = sp.test_account("Admin")
    minter = sp.test_account("Minter")
    treasury = sp.test_account("Treasury")
    artist = sp.test_account("Artist")
    new_admin = sp.test_account("NewAdmin")
    resolver, provider, factory = _setup(scenario, admin, minter, treasury)

    factory.deploy(_deploy_params(provider), _sender=artist)

    factory.admin_lambda(
        aleatory.identity_lambda, _sender=artist, _valid=False
    )
    factory.admin_lambda(aleatory.identity_lambda, _sender=admin)

    # Succession: two-step, and only the proposed admin can accept.
    factory.propose_admin(new_admin.address, _sender=artist, _valid=False)
    factory.propose_admin(new_admin.address, _sender=admin)
    factory.accept_admin(_sender=admin, _valid=False)
    factory.accept_admin(_sender=new_admin)
    scenario.verify(factory.data.administrator == new_admin.address)
    factory.set_deploy_price(sp.mutez(1), _sender=admin, _valid=False)
    factory.set_deploy_price(sp.mutez(1), _sender=new_admin)


@sp.add_test()
def test_registry_is_open():
    """Anyone lists a provider; only that provider's own operator can
    delist it. There is no fee and no gatekeeper."""
    scenario = sp.test_scenario("Registry", aleatory)
    admin = sp.test_account("Admin")
    minter = sp.test_account("Minter")
    treasury = sp.test_account("Treasury")
    stranger = sp.test_account("Stranger")
    rival_op = sp.test_account("RivalOperator")
    rival_key = sp.test_account("RivalKey")
    resolver, provider, factory = _setup(scenario, admin, minter, treasury)

    registry = aleatory.AleatoryRegistry()
    scenario += registry

    rival = aleatory.AleatoryProvider(
        operator=rival_op.address,
        agent=rival_key.address,
        render_gas=sp.mutez(50_000),
        metadata=_META,
    )
    scenario += rival

    # A stranger can list someone else's provider — it is a public index,
    # not a claim of ownership.
    registry.register(rival.address, _sender=stranger)
    scenario.verify(registry.data.count == 1)
    registry.register(rival.address, _sender=stranger, _valid=False)

    # Something that is not a provider cannot be listed.
    registry.register(factory.address, _sender=stranger, _valid=False)

    # Only the provider's own operator may delist it.
    registry.deregister(rival.address, _sender=stranger, _valid=False)
    registry.deregister(rival.address, _sender=admin, _valid=False)
    registry.deregister(rival.address, _sender=rival_op)
    scenario.verify(registry.data.count == 0)
