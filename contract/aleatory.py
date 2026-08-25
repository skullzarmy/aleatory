"""Aleatory, collections, the factory that deploys them, and the render
provider machinery around them.

**Collection**, one per project, originated by the factory, owned by the
artist from the moment it exists. Standard FA2 (TZIP-12) holding exactly one
generator and its edition. **No admin lambda, no upgrade path, no platform
fee, and no authority retained by us.** A bug in this template is frozen
into every collection already deployed; that is the price of the guarantee,
and the reason it stays boring.

**Factory**, originates a collection in one operation with the caller
already installed as its administrator. Holds no tokens, so its
`admin_lambda` escape hatch cannot reach anyone's NFT. That is the point of
the split: the contract that needs to be upgradable holds nothing, and the
contract that holds everything cannot be touched.

**Provider**, a render provider's price and working key. Any contract
exposing `get_render_gas` and `get_agent` and able to receive tez is a
provider; those views are the entire membership test.

**Registry**, a permissionless, free list of providers, so a UI can
enumerate them without asking us.

**Resolver**, our own working keys in one place, so rotating a leaked one
does not mean touching every collection. A collection may sever it
(`set_trust_resolver`), and does not depend on it.

The flow:

1. **`buy`**, the collector's single signature. Pays the artist and the
   render provider, and **mints the token in that same operation**, carrying
   the collection's "not revealed yet" metadata. This operation's hash is
   the seed.
2. **`set_token_metadata`**, an authorised render provider publishes that
   piece's real metadata document, once.

Token metadata is an `ipfs://` pointer under `token_info[""]`, which is what
every other Tezos NFT does. Nothing is composed on chain. Royalties are kept
*additionally* as a typed map with a view, because a marketplace contract
cannot read IPFS and would otherwise have to trust whoever made a listing.

The artwork does not depend on any of that: the code is immutable in
storage, the seed is the buy operation's hash, and the parameters are in
that same operation. Metadata is where a marketplace reads *about* a piece.

The template is a starting point, not a requirement. Anything standard FA2
gets indexed and traded. What a third-party contract must match to use a
render provider is the interface, the `buy` and `set_token_metadata`
events, and the pending-document rule for finding unrendered pieces, not
this implementation.

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
        code_hash=sp.bytes,
        edition_size=sp.nat,
        price=sp.mutez,
        # Royalty shares in basis points of the sale price, by recipient.
        # 1250 = 12.5%. Kept on chain *as well as* in the metadata JSON:
        # a marketplace contract cannot read IPFS, so without this it would
        # have to trust whatever a lister passed in, and a seller could
        # list with royalties zeroed out. Teia's arrangement.
        royalties=sp.map[sp.address, sp.nat],
        # The metadata URI every token is minted with, an ipfs:// pointer
        # to the collection's "not revealed yet" JSON. A provider replaces
        # it per token with that piece's real metadata once rendered.
        pending_metadata=sp.bytes,
        start_paused=sp.bool,
        metadata=sp.big_map[sp.string, sp.bytes],
    )

    # The collection's complete storage. Declared explicitly because the
    # factory has to construct this exact shape in `sp.create_contract`;
    # the child casts `self.data` to it so the two can never drift apart
    # silently.
    # The collection's complete storage, grouped rather than flat.
    #
    # SmartPy rebuilds the whole storage record in every entrypoint, and the
    # cost of that grows faster than linearly with the number of top-level
    # fields, a measured 36% of the compiled contract, for a record this
    # wide. Grouping by who writes what means an entrypoint rebuilds one
    # subtree instead of twenty fields, and origination burn is paid by the
    # artist, so this is their money.
    #
    # Declared explicitly because the factory constructs this exact shape in
    # `sp.create_contract`; the child casts `self.data` to it so the two
    # cannot drift apart silently.
    t_art: type = sp.record(
        code_uri=sp.string,
        code_hash=sp.bytes,
        # Royalty shares in basis points of the sale price, by recipient.
        # 1250 = 12.5%. Kept on chain *as well as* in the metadata JSON:
        # a marketplace contract cannot read IPFS, so without this it would
        # have to trust whatever a lister passed in, and a seller could
        # list with royalties zeroed out. Teia's arrangement.
        royalties=sp.map[sp.address, sp.nat],
        # The metadata URI every token is minted with, an ipfs:// pointer
        # to the collection's "not revealed yet" JSON. A provider replaces
        # it per token with that piece's real metadata once rendered.
        pending_metadata=sp.bytes,
    )

    t_sale: type = sp.record(
        price=sp.mutez,
        edition_size=sp.nat,
        paused=sp.bool,
    )

    t_render: type = sp.record(
        resolver=sp.address,
        trust_resolver=sp.bool,
        local_writers=sp.set[sp.address],
        provider=sp.address,
        provider_agent=sp.address,
        render_gas=sp.mutez,
    )

    t_collection_storage: type = sp.record(
        administrator=sp.address,
        proposed_admin=sp.option[sp.address],
        art=t_art,
        sale=t_sale,
        render=t_render,
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
        """The one place our own render-provider keys are listed.

        Collections call `is_writer` as an on-chain view. Rotating a leaked
        soft wallet is one operation here rather than one per collection
        ever deployed.

        These keys publish token metadata; they cannot mint, price, pause,
        or change an edition. Nothing here can.

        The cost of the convenience, stated plainly: whoever administers
        this contract can authorise a writer into every collection that
        trusts it. Two things bound that, a collection's resolver is fixed
        at origination, so it cannot be repointed at a different authority
        afterwards, and any artist can sever it outright with
        `set_trust_resolver`. See `AleatoryCollection.may_write_media_`.
        """

        def __init__(self, administrator, writers):
            self.data.administrator = administrator
            self.data.proposed_admin = sp.cast(None, sp.option[sp.address])
            self.data.writers = sp.cast(writers, sp.set[sp.address])

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
        def add_writer(self, writer):
            sp.cast(writer, sp.address)
            assert sp.amount == sp.mutez(0), "TEZ_NOT_ACCEPTED"
            assert sp.sender == self.data.administrator, "NOT_ADMIN"
            self.data.writers.add(writer)
            sp.emit(sp.record(writer=writer), tag="add_writer")

        @sp.entrypoint
        def remove_writer(self, writer):
            """Instantly disables a retired or leaked key everywhere."""
            sp.cast(writer, sp.address)
            assert sp.amount == sp.mutez(0), "TEZ_NOT_ACCEPTED"
            assert sp.sender == self.data.administrator, "NOT_ADMIN"
            self.data.writers.remove(writer)
            sp.emit(sp.record(writer=writer), tag="remove_writer")

        @sp.onchain_view()
        def is_writer(self, writer):
            sp.cast(writer, sp.address)
            return writer in self.data.writers

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
        beyond the one-time media write below, not for the artist, not for
        the factory, not for us. A bug in this template is frozen into every
        collection already deployed, which is the price of that guarantee
        and the reason this contract stays boring.

        The artist administers it: pause, reprice, shrink or close the
        edition, choose a render provider, and a local writer override.
        `code_uri`, `code_hash` and `pending_metadata` have no setter
        anywhere; `edition_size` can only ever go down.
        """

        def __init__(self, init):
            sp.cast(init, t_collection_init)

            main.OnchainviewBalanceOf.__init__(self)
            main.OffchainviewTokenMetadata.__init__(self)
            main.Nft.__init__(self, init.metadata, {}, [])

            self.data.administrator = init.administrator
            self.data.proposed_admin = sp.cast(None, sp.option[sp.address])

            self.data.art = sp.record(
                code_uri=init.code_uri,
                code_hash=init.code_hash,
                royalties=init.royalties,
                pending_metadata=init.pending_metadata,
            )
            self.data.sale = sp.record(
                price=init.price,
                edition_size=init.edition_size,
                paused=init.start_paused,
            )
            self.data.render = sp.record(
                # Where writer authorisation is resolved from. Fixed at
                # origination: a collection that could be repointed later
                # would be one whose authority we could seize after the
                # fact. The artist may switch it off entirely, not move it.
                resolver=init.resolver,
                trust_resolver=True,
                local_writers=sp.cast(set(), sp.set[sp.address]),
                provider=init.provider,
                provider_agent=init.provider_agent,
                render_gas=init.render_gas,
            )

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
            self.data.sale.price = price
            sp.emit(sp.record(price=price), tag="set_price")

        @sp.entrypoint
        def set_paused(self, new_state):
            """Pause the **sale**. Transfers of existing pieces are never
            affected, a paused project still trades on the secondary
            market."""
            sp.cast(new_state, sp.bool)
            assert sp.amount == sp.mutez(0), "TEZ_NOT_ACCEPTED"
            assert self.is_artist_(), "NOT_ARTIST"
            self.data.sale.paused = new_state
            sp.emit(sp.record(paused=new_state), tag="set_paused")

        @sp.entrypoint
        def set_edition_size(self, new_size):
            """(Artist only) Shrink the edition, or close it.

            Never grows: there is no path in this contract that raises an
            edition size, because that would rewrite what collectors
            bought into. Shrinking only makes existing pieces scarcer, so
            no holder is harmed by it.

            Setting the size to the number already minted closes the
            edition permanently, that is what replaces a separate
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
            if self.data.sale.edition_size != 0:
                assert new_size <= self.data.sale.edition_size, "CANNOT_GROW"
            self.data.sale.edition_size = new_size
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

            The price and working key are read from the provider's own
            contract, which must expose `get_render_gas` and `get_agent`
            views, those are the entire membership test for being a
            provider. Anyone can deploy one.

            `max_price` is the artist's ceiling, so a provider raising
            their price between quote and signature fails the call rather
            than silently charging more.

            Switchable on purpose. A provider that is down, overpriced or
            gone must not be able to strand a collection, pieces it never
            rendered stay publishable by whoever comes next, since a piece
            still holding the pending document is a piece anyone authorised
            can publish.
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
            self.data.render.provider = provider
            self.data.render.provider_agent = agent
            self.data.render.render_gas = quoted
            sp.emit(
                sp.record(
                    provider=provider, agent=agent, render_gas=quoted
                ),
                tag="set_provider",
            )

        @sp.entrypoint
        def set_trust_resolver(self, trusted):
            """(Artist only) Whether the resolver may authorise writers here.

            Turning it off severs the last thread of authority anyone but
            the artist holds over this collection. An artist using a rival
            provider should be able to do that, and until they do, the
            resolver's operator can write images into their collection.
            """
            sp.cast(trusted, sp.bool)
            assert sp.amount == sp.mutez(0), "TEZ_NOT_ACCEPTED"
            assert self.is_artist_(), "NOT_ARTIST"
            self.data.render.trust_resolver = trusted
            sp.emit(sp.record(trusted=trusted), tag="set_trust_resolver")

        @sp.entrypoint
        def set_local_writer(self, writer, allowed):
            """(Artist only) Authorise someone to publish this collection's
            token metadata directly, without going through a provider
            contract or the resolver.

            The artist's insurance: against a resolver that is broken,
            captured or gone, and against a provider that has stopped
            answering. It authorises publishing metadata and nothing else.
            """
            sp.cast(writer, sp.address)
            sp.cast(allowed, sp.bool)
            assert sp.amount == sp.mutez(0), "TEZ_NOT_ACCEPTED"
            assert self.is_artist_(), "NOT_ARTIST"
            if allowed:
                self.data.render.local_writers.add(writer)
            else:
                self.data.render.local_writers.remove(writer)
            sp.emit(
                sp.record(writer=writer, allowed=allowed),
                tag="set_local_writer",
            )

        # --- sale ---

        @sp.entrypoint
        def buy(self, params):
            """(Anyone, payable) Buy one edition. One signature, and the
            token exists when it returns.

            **The piece is minted here, in the collector's own operation.**
            The token exists, is owned, and is tradeable the moment this
            returns; it carries the collection's "not revealed yet"
            metadata until a provider publishes the piece's own. An
            unrevealed piece is a real token, not a promise of one, which
            is why there is nothing to strand, nothing to refund, and
            nothing a failed provider can take away.

            What the artwork *is* does not depend on that metadata: the
            code is immutable in this contract's storage, the seed is this
            operation's hash, and the parameters are in this operation.
            Metadata is where a marketplace reads about the piece, not
            where the piece is defined.

            THIS OPERATION'S HASH IS THE SEED SOURCE, and it is also the
            operation that mints, so the binding needs no extra record: a
            token's seed derives from the hash of the operation that
            created it.

            It does *not* make grinding expensive, the hash covers
            sender-controlled fields, so candidates are enumerated offline
            and only the chosen one is injected. Documented tradeoff of an
            op-hash seed, accepted rather than engineered around.

            `params` is the canonical-JSON encoding of the collector's
            resolved parameter values (params.md §3), empty when the
            generator declares none. It is recorded in this operation, by
            their own signature, which is what a provider reads to know
            what to render, and what anyone else reads to check the result.

            Payment is `price + render_gas`, split in this same operation:
            the price to the artist, the render gas to the provider. The
            contract holds nothing when it returns, no escrow, no
            balance, no withdraw entrypoint.
            """
            sp.cast(params, sp.bytes)
            assert not self.data.sale.paused, "PAUSED"
            assert (
                sp.amount == self.data.sale.price + self.data.render.render_gas
            ), "WRONG_PRICE"
            # edition_size 0 is an open edition.
            assert (
                self.data.sale.edition_size == 0
                or self.data.next_token_id < self.data.sale.edition_size
            ), "SOLD_OUT"

            token_id = self.data.next_token_id

            # The standard Tezos shape: one empty-string key holding an
            # ipfs:// pointer to the metadata JSON, which is where name,
            # artifactUri, displayUri, royalties and attributes all live.
            # Minted with the collection's "not revealed yet" document; a
            # provider swaps in the piece's own once it has rendered it.
            token_info = sp.cast(
                {"": self.data.art.pending_metadata},
                sp.map[sp.string, sp.bytes],
            )
            self.data.token_metadata[token_id] = sp.record(
                token_id=token_id, token_info=token_info
            )
            self.data.ledger[token_id] = sp.sender
            self.data.next_token_id += 1

            # Paid inline, both of them. A bad artist or provider address
            # breaks that collection's own sales and nobody else's.
            # Paid to the provider *contract*, not to the agent: the
            # signing key should never hold funds. Requires the provider to
            # accept tez, which is part of being a provider.
            if self.data.render.render_gas > sp.mutez(0):
                sp.send(self.data.render.provider, self.data.render.render_gas)
            if self.data.sale.price > sp.mutez(0):
                sp.send(self.data.administrator, self.data.sale.price)

            sp.emit(
                sp.record(
                    token_id=token_id,
                    buyer=sp.sender,
                    params=params,
                    paid=sp.amount,
                    render_gas=self.data.render.render_gas,
                ),
                tag="buy",
            )

        # --- media ---

        @sp.private(with_storage="read-only")
        def may_write_media_(self, who):
            """The collection's own provider, an address the artist
            authorised directly, or one the resolver vouches for.

            The resolver is consulted through a view that may fail, if it
            is gone or broken the call yields nothing and we fall through,
            rather than reverting. A dead resolver must not permanently
            freeze every collection that trusted it.
            """
            sp.cast(who, sp.address)
            # The provider's *current* agent, asked live. A provider that
            # rotates a leaked key must not need every collection to
            # re-snapshot before it can work again, that is the
            # N-transactions problem the resolver exists to avoid, and
            # third-party providers have no resolver behind them.
            #
            # Safe to call out here in a way it would not be in `buy`: this
            # entrypoint is called by the provider itself, so a broken
            # provider contract only breaks its own renders. The stored
            # snapshot stays as the fallback if the view is gone.
            live = sp.view("get_agent", self.data.render.provider, (), sp.address)
            allowed = False
            if live.is_some():
                # The provider answered: its current agent is the only one
                # that counts. The snapshot must NOT also be accepted here,
                # or rotating a leaked key would never revoke it.
                allowed = live == sp.Some(who)
            else:
                # Provider contract gone or broken. Fall back to whatever
                # was snapshotted, so an unreachable provider degrades to
                # its last known good state rather than to nothing.
                allowed = who == self.data.render.provider_agent
            if not allowed:
                allowed = who in self.data.render.local_writers
            if not allowed and self.data.render.trust_resolver:
                resolved = sp.view(
                    "is_writer", self.data.render.resolver, who, sp.bool
                )
                allowed = resolved == sp.Some(True)
            return allowed

        @sp.entrypoint
        def set_token_metadata(self, token_id, metadata_uri):
            """(Authorised writer) Publish a piece's real metadata, once.

            Replaces the collection's pending document with this token's
            own, the JSON carrying its name, artifactUri, displayUri,
            royalties and attributes, pinned by whoever rendered it.

            This is the conventional Tezos arrangement, and it means a
            provider writes a token's *whole* metadata rather than two
            fields of it. That is a real grant of trust, and it is the same
            one every platform doing generative art on Tezos already makes:
            there is no way to produce a rendered image without executing
            the artwork, and no way to publish one without saying where it
            lives.

            What bounds it: it can be done once per token, only by someone
            the artist authorised, and never for a token that already has
            its metadata. Everything it publishes is checkable, the seed
            comes from the mint operation, the parameters are in that
            operation too, and the code is immutable, so the correct output
            is reproducible by anyone. Detection and key rotation, not a
            guarantee the chain can enforce.

            No payment happens here; the provider was paid at `buy`.
            """
            sp.cast(token_id, sp.nat)
            sp.cast(metadata_uri, sp.bytes)
            assert sp.amount == sp.mutez(0), "TEZ_NOT_ACCEPTED"
            assert self.may_write_media_(sp.sender), "NOT_AUTHORISED"
            assert sp.len(metadata_uri) > 0, "EMPTY_METADATA_URI"
            assert (
                metadata_uri != self.data.art.pending_metadata
            ), "IS_PENDING_DOC"

            token = self.data.token_metadata.get(token_id, error="NO_TOKEN")
            # Write-once, and the same rule providers use off chain to find
            # pending work: a piece still holding the collection's pending
            # document is a piece nobody has rendered.
            assert (
                token.token_info[""] == self.data.art.pending_metadata
            ), "ALREADY_PUBLISHED"

            token.token_info[""] = metadata_uri
            self.data.token_metadata[token_id] = token

            sp.emit(
                sp.record(
                    token_id=token_id,
                    metadata_uri=metadata_uri,
                    renderer=sp.sender,
                ),
                tag="set_token_metadata",
            )

        # --- views ---

        @sp.onchain_view()
        def needs_render(self, token_id):
            """Whether a piece is still holding the pending document, the
            same rule providers use off chain, so the two cannot disagree."""
            sp.cast(token_id, sp.nat)
            token = self.data.token_metadata.get(token_id, error="NO_TOKEN")
            return token.token_info[""] == self.data.art.pending_metadata

        @sp.onchain_view()
        def get_royalties(self):
            """Royalty shares in basis points of the sale price.

            What a marketplace calls to pay artists without trusting the
            seller. The same numbers appear in each piece's metadata JSON
            for readers that cannot reach chain state, two representations
            of one immutable fact, written at deploy and never changed.
            """
            return self.data.art.royalties

        @sp.onchain_view()
        def get_edition(self):
            """Everything needed to rebuild the edition from chain state."""
            return sp.record(
                artist=self.data.administrator,
                code_uri=self.data.art.code_uri,
                code_hash=self.data.art.code_hash,
                royalties=self.data.art.royalties,
                edition_size=self.data.sale.edition_size,
                minted=self.data.next_token_id,
                price=self.data.sale.price,
                render_gas=self.data.render.render_gas,
                provider=self.data.render.provider,
                provider_agent=self.data.render.provider_agent,
                trust_resolver=self.data.render.trust_resolver,
                pending_metadata=self.data.art.pending_metadata,
                paused=self.data.sale.paused,
            )

    # ---------------------------------------------------------------
    # Provider
    # ---------------------------------------------------------------

    class AleatoryProvider(sp.Contract):
        """A render provider's price, on chain.

        This contract is not required, anything exposing `get_render_gas`
        and `get_agent` views and able to receive tez is a provider. Those
        two views are the whole membership test.

        It separates three roles on purpose: `operator` is the cold key
        that configures and withdraws, `agent` is the hot key a render
        daemon uses to call `set_token_metadata`, and the contract itself
        holds the income. A leaked agent key is rotated in one operation
        and gives an attacker no money.

        It is here as the reference implementation, so that "run your own
        renderer and sell the service" is a deploy rather than a
        negotiation.

        Collections snapshot the quote when the artist picks the provider,
        so a price change never affects a collection that already agreed to
        an older one until its artist re-snapshots.
        """

        def __init__(self, operator, agent, render_gas, metadata):
            self.data.operator = operator
            # The key that does the work: it calls `set_token_metadata`.
            # It is *not* paid, render gas accrues in this contract and the
            # operator withdraws it, so a hot key living in a render daemon
            # never also holds income.
            self.data.agent = agent
            self.data.render_gas = render_gas
            # TZIP-16 metadata: name, and the push endpoint a mint UI can
            # ping for latency. Deliberately here rather than in a storage
            # field with its own entrypoint, endpoints rot, metadata is
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
        def default(self):
            """Accept render gas. Collections pay this contract, not the
            agent, which is the whole reason this entrypoint exists, since a
            KT1 with no default entrypoint cannot be sent tez at all."""
            pass

        @sp.entrypoint
        def withdraw(self, amount, to_):
            """(Operator only) Sweep accrued render gas."""
            sp.cast(amount, sp.mutez)
            sp.cast(to_, sp.address)
            assert sp.amount == sp.mutez(0), "TEZ_NOT_ACCEPTED"
            assert sp.sender == self.data.operator, "NOT_OPERATOR"
            assert amount <= sp.balance, "INSUFFICIENT"
            sp.send(to_, amount)
            sp.emit(sp.record(to=to_, amount=amount), tag="withdraw")

        @sp.entrypoint
        def set_agent(self, agent):
            """(Operator only) Rotate the working key.

            Every collection using this provider follows immediately: they
            ask for the current agent when authorising a write, rather than
            trusting the value they snapshotted. No artist has to do
            anything, which is the point, a leaked key must be revocable
            in one operation."""
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

        Registration is permissionless and free. There is no fee and no
        allowlist, and the only address that can remove an entry is the
        operator of that provider itself, not us, not an artist, not
        another provider. Deliberately not a gate anyone holds. Deploying
        a provider contract
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
            is checked by asking the contract itself. Nobody else, not us,
            not an artist, not another provider, can delist anyone.
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
        NFT, which is exactly why the escape hatch lives on this contract
        and not on the one that holds the art.

        What the lambda can and cannot do, precisely: it transforms factory
        *storage*. It cannot change the collection template, because that
        template is Michelson code compiled into this contract and contract
        code is immutable. A new template means a new factory, which is
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
            its *initial storage*, it is never held by us and handed over.
            One signature, no second step, nothing of the artist's passing
            through our hands.

            Storage burn and gas for the origination are charged to the
            operation's source, which is the artist's wallet. The factory
            fronts nothing.

            `deploy_price` is zero. The artist's own origination burn is
            already a real floor against spam, so there is nothing to
            charge for; the field exists so an anti-spam lever remains
            possible without deploying a new factory, and any change to it
            would be visible on chain. Collections carry no platform fee on
            primary sales either, the price goes to the artist and the
            render gas to the provider.

            Note for callers: the artist's operation needs a storage limit
            large enough for the child contract. Wallet estimation handles
            this; anything hardcoded will break the day the template grows.
            """
            sp.cast(
                params,
                sp.record(
                    code_uri=sp.string,
                    code_hash=sp.bytes,
                    edition_size=sp.nat,
                    price=sp.mutez,
                    royalties=sp.map[sp.address, sp.nat],
                    pending_metadata=sp.bytes,
                    start_paused=sp.bool,
                    provider=sp.address,
                    max_render_gas=sp.mutez,
                    metadata=sp.big_map[sp.string, sp.bytes],
                ),
            )
            assert not self.data.paused, "PAUSED"
            assert sp.amount == self.data.deploy_price, "WRONG_FEE"
            assert sp.len(params.code_uri) > 0, "EMPTY_CODE_URI"

            # Marketplace convention rather than protocol rule, but it is
            # enforced here because royalties are immutable once a
            # collection exists: past roughly a quarter, marketplaces stop
            # honouring them and the piece becomes awkward to trade.
            total_royalty = sp.cast(0, sp.nat)
            for share in params.royalties.values():
                total_royalty += share
            assert total_royalty <= 2500, "ROYALTY_TOO_HIGH"

            # The provider quotes its own price through a view it exposes;
            # that view is the entire membership test for being a provider.
            # `max_render_gas` is the artist's ceiling, so a provider
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
                    art=sp.record(
                        code_uri=params.code_uri,
                        code_hash=params.code_hash,
                        royalties=params.royalties,
                        pending_metadata=params.pending_metadata,
                    ),
                    sale=sp.record(
                        price=params.price,
                        edition_size=params.edition_size,
                        paused=params.start_paused,
                    ),
                    render=sp.record(
                        resolver=self.data.resolver,
                        trust_resolver=True,
                        local_writers=sp.set(),
                        provider=params.provider,
                        provider_agent=agent,
                        render_gas=quoted,
                    ),
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
            were born with, theirs is fixed, by design."""
            sp.cast(resolver, sp.address)
            assert sp.amount == sp.mutez(0), "TEZ_NOT_ACCEPTED"
            assert self.is_administrator_(), "NOT_ADMIN"
            self.data.resolver = resolver
            sp.emit(sp.record(resolver=resolver), tag="set_resolver")

        @sp.entrypoint
        def set_paused(self, new_state):
            """(Admin only) Stop new deployments. Has no effect on any
            collection already deployed, we have no authority there."""
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
