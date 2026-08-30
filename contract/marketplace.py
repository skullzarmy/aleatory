"""Aleatory Marketplace, secondary market for pieces minted on the platform.

Copies what objkt and Teia already do rather than inventing anything. A
seller escrows the token and names a price; a buyer pays it; the contract
splits the proceeds and moves the token. Offers work the same way with the
tez escrowed instead.

**Royalties are read from the collection, not from the listing.** The
collection exposes a `get_royalties` view returning shares in basis points,
so a seller cannot list a piece with the artist's royalties zeroed out.
That is the whole reason those numbers live on chain as well as in the
metadata JSON, a contract cannot read IPFS.

**The platform fee is 2.5%, taken out of the sale.** The seller nets the
price minus fee minus royalties, which is how objkt does it. It is
changeable by the administrator going forward and never retroactively:
a listing settles on the fee that was in force when it was created, because
the fee is copied into the listing at that moment.

What the administrator cannot do: touch a listing, touch a token, take a
seller's proceeds, or raise the fee past a ceiling the contract enforces.
**There is no `admin_lambda` here**, unlike the factory, this contract
holds other people's property in escrow, and an escape hatch over its
storage would be an escape hatch over their tokens and their tez. If this
contract needs to change, it gets replaced, and everyone withdraws from the
old one first. `paused` stops new listings and offers; it never traps an
existing one, because delisting and cancelling stay open while paused.

Escrow, deliberately: a listed token lives in this contract, and offered tez
lives in this contract. It is the arrangement Teia uses. The alternative , 
leaving both with their owners and relying on FA2 operator rights, means
listings that silently cannot be filled because the seller moved the token,
and offers that cannot be filled because the tez is spent.
"""

import smartpy as sp


@sp.module
def marketplace():
    # A live listing: one token, escrowed here, at a price.
    #
    # `fee_bps` is copied in at listing time so a later fee change cannot
    # alter the terms of a sale already on offer.
    t_listing: type = sp.record(
        seller=sp.address,
        collection=sp.address,
        token_id=sp.nat,
        price=sp.mutez,
        fee_bps=sp.nat,
    ).layout(
        (
            "seller",
            ("collection", ("token_id", ("price", "fee_bps"))),
        )
    )

    # A standing offer on a specific token, with the tez escrowed here.
    t_offer: type = sp.record(
        buyer=sp.address,
        collection=sp.address,
        token_id=sp.nat,
        amount=sp.mutez,
        fee_bps=sp.nat,
    ).layout(
        (
            "buyer",
            ("collection", ("token_id", ("amount", "fee_bps"))),
        )
    )

    t_transfer_batch: type = sp.list[
        sp.record(
            from_=sp.address,
            txs=sp.list[
                sp.record(
                    to_=sp.address, token_id=sp.nat, amount=sp.nat
                ).layout(("to_", ("token_id", "amount")))
            ],
        ).layout(("from_", "txs"))
    ]

    t_storage: type = sp.record(
        administrator=sp.address,
        proposed_admin=sp.option[sp.address],
        paused=sp.bool,
        fee_bps=sp.nat,
        treasury=sp.address,
        fees_accrued=sp.mutez,
        listings=sp.big_map[sp.nat, t_listing],
        next_listing_id=sp.nat,
        offers=sp.big_map[sp.nat, t_offer],
        next_offer_id=sp.nat,
        metadata=sp.big_map[sp.string, sp.bytes],
    )

    class AleatoryMarketplace(sp.Contract):
        def __init__(self, administrator, treasury, fee_bps, metadata):
            # The same ceiling `set_fee` applies. A deployment above it would
            # make every sale fail on an underflow until an administrator
            # fixed it, and the promise that no administrator can turn the fee
            # into a toll has to hold from origination.
            assert fee_bps <= 1000, "FEE_TOO_HIGH"
            self.data.administrator = administrator
            self.data.proposed_admin = sp.cast(None, sp.option[sp.address])
            self.data.paused = False
            self.data.fee_bps = fee_bps
            self.data.treasury = treasury
            self.data.fees_accrued = sp.mutez(0)
            self.data.listings = sp.cast(
                sp.big_map(), sp.big_map[sp.nat, t_listing]
            )
            self.data.next_listing_id = 0
            self.data.offers = sp.cast(
                sp.big_map(), sp.big_map[sp.nat, t_offer]
            )
            self.data.next_offer_id = 0
            self.data.metadata = sp.cast(
                metadata, sp.big_map[sp.string, sp.bytes]
            )
            sp.cast(self.data, t_storage)

        # --- helpers ---

        @sp.private(with_storage="read-only")
        def is_administrator_(self):
            return sp.sender == self.data.administrator

        # --- listings ---

        @sp.entrypoint
        def list_token(self, collection, token_id, price):
            """(Anyone) Escrow a token here and offer it at a price.

            The token moves into this contract, so a listing can always be
            filled, it cannot go stale because the seller moved the piece
            somewhere else. Requires the seller to have made this contract
            an operator first, per the usual FA2 dance.
            """
            sp.cast(collection, sp.address)
            sp.cast(token_id, sp.nat)
            sp.cast(price, sp.mutez)
            assert sp.amount == sp.mutez(0), "TEZ_NOT_ACCEPTED"
            assert not self.data.paused, "PAUSED"

            listing_id = self.data.next_listing_id
            self.data.listings[listing_id] = sp.record(
                seller=sp.sender,
                collection=collection,
                token_id=token_id,
                price=price,
                fee_bps=self.data.fee_bps,
            )
            self.data.next_listing_id += 1

            sp.transfer(
                [
                    sp.record(
                        from_=sp.sender,
                        txs=[sp.record(to_=sp.self_address, token_id=token_id, amount=1)],
                    )
                ],
                sp.mutez(0),
                sp.contract(
                    t_transfer_batch, collection, entrypoint="transfer"
                ).unwrap_some(error="BAD_COLLECTION"),
            )

            sp.emit(
                sp.record(
                    listing_id=listing_id,
                    seller=sp.sender,
                    collection=collection,
                    token_id=token_id,
                    price=price,
                ),
                tag="list",
            )

        @sp.entrypoint
        def delist(self, listing_id):
            """(Seller only) Take a listing down and get the token back.

            Works while paused: pausing must never trap someone's property
            in this contract.
            """
            sp.cast(listing_id, sp.nat)
            assert sp.amount == sp.mutez(0), "TEZ_NOT_ACCEPTED"
            listing = self.data.listings.get(listing_id, error="NO_LISTING")
            assert sp.sender == listing.seller, "NOT_SELLER"
            del self.data.listings[listing_id]

            sp.transfer(
                [
                    sp.record(
                        from_=sp.self_address,
                        txs=[sp.record(to_=listing.seller, token_id=listing.token_id, amount=1)],
                    )
                ],
                sp.mutez(0),
                sp.contract(
                    t_transfer_batch, listing.collection, entrypoint="transfer"
                ).unwrap_some(error="BAD_COLLECTION"),
            )
            sp.emit(sp.record(listing_id=listing_id), tag="delist")

        @sp.entrypoint
        def buy(self, listing_id):
            """(Anyone, payable) Buy a listed piece at its asking price."""
            sp.cast(listing_id, sp.nat)
            assert not self.data.paused, "PAUSED"
            listing = self.data.listings.get(listing_id, error="NO_LISTING")
            assert sp.amount == listing.price, "WRONG_PRICE"
            del self.data.listings[listing_id]

            # Split the sale in this operation: platform fee, then royalties
            # read from the collection itself, then whatever is left to the
            # seller. Royalties never come from the listing, so a seller
            # cannot zero out the artist's share.
            #
            # Paid rather than held. A recipient that rejects tez reverts the
            # sale, which is why a front end originating a collection has to
            # check its royalty addresses before they become immutable
            # (ALEATORY-001 section 1). Holding them instead meant an artist
            # had money in a contract they had to know to claim.
            fee = sp.split_tokens(sp.amount, listing.fee_bps, 10000)
            self.data.fees_accrued += fee
            remaining = sp.amount - fee

            # A collection we did not deploy can say anything here, and a
            # hostile one could claim 100% and take the seller's proceeds
            #, or claim more than is left and make every sale of its
            # tokens fail. So the total honoured is clamped: shares are
            # paid in order until the cap is reached, and anything past it
            # is ignored rather than trusted. Our own collections cap at
            # the same figure when they are deployed, so this changes
            # nothing for them and protects sellers of everything else.
            royalties = sp.view(
                "get_royalties", listing.collection, (), sp.map[sp.address, sp.nat]
            )
            if royalties.is_some():
                budget = sp.cast(2500, sp.nat)
                for recipient in royalties.unwrap_some().items():
                    share = recipient.value
                    if share > budget:
                        share = budget
                    budget = sp.as_nat(budget - share)
                    cut = sp.split_tokens(sp.amount, share, 10000)
                    if cut > sp.mutez(0):
                        remaining -= cut
                        sp.send(recipient.key, cut)

            if remaining > sp.mutez(0):
                sp.send(listing.seller, remaining)
            sp.transfer(
                [
                    sp.record(
                        from_=sp.self_address,
                        txs=[sp.record(to_=sp.sender, token_id=listing.token_id, amount=1)],
                    )
                ],
                sp.mutez(0),
                sp.contract(
                    t_transfer_batch, listing.collection, entrypoint="transfer"
                ).unwrap_some(error="BAD_COLLECTION"),
            )

            sp.emit(
                sp.record(
                    listing_id=listing_id,
                    collection=listing.collection,
                    token_id=listing.token_id,
                    seller=listing.seller,
                    buyer=sp.sender,
                    price=sp.amount,
                ),
                tag="sale",
            )

        # --- offers ---

        @sp.entrypoint
        def make_offer(self, collection, token_id):
            """(Anyone, payable) Offer on a specific piece, escrowing the tez.

            Escrowed so an accepted offer can always be paid. The offer is
            open to whoever holds the token when it is accepted, which is
            how both objkt and Teia behave.
            """
            sp.cast(collection, sp.address)
            sp.cast(token_id, sp.nat)
            assert not self.data.paused, "PAUSED"
            assert sp.amount > sp.mutez(0), "ZERO_OFFER"

            offer_id = self.data.next_offer_id
            self.data.offers[offer_id] = sp.record(
                buyer=sp.sender,
                collection=collection,
                token_id=token_id,
                amount=sp.amount,
                fee_bps=self.data.fee_bps,
            )
            self.data.next_offer_id += 1

            sp.emit(
                sp.record(
                    offer_id=offer_id,
                    buyer=sp.sender,
                    collection=collection,
                    token_id=token_id,
                    amount=sp.amount,
                ),
                tag="offer",
            )

        @sp.entrypoint
        def cancel_offer(self, offer_id):
            """(Offerer only) Withdraw an offer and take the tez back.

            Works while paused, for the same reason `delist` does.
            """
            sp.cast(offer_id, sp.nat)
            assert sp.amount == sp.mutez(0), "TEZ_NOT_ACCEPTED"
            offer = self.data.offers.get(offer_id, error="NO_OFFER")
            assert sp.sender == offer.buyer, "NOT_OFFERER"
            del self.data.offers[offer_id]
            sp.send(offer.buyer, offer.amount)
            sp.emit(sp.record(offer_id=offer_id), tag="cancel_offer")

        @sp.entrypoint
        def accept_offer(self, offer_id):
            """(Token holder) Sell into a standing offer.

            The caller must hold the token and have made this contract an
            operator. Settlement is identical to a purchase, including
            royalties read from the collection.
            """
            sp.cast(offer_id, sp.nat)
            assert sp.amount == sp.mutez(0), "TEZ_NOT_ACCEPTED"
            assert not self.data.paused, "PAUSED"
            offer = self.data.offers.get(offer_id, error="NO_OFFER")
            del self.data.offers[offer_id]

            sp.transfer(
                [
                    sp.record(
                        from_=sp.sender,
                        txs=[sp.record(to_=offer.buyer, token_id=offer.token_id, amount=1)],
                    )
                ],
                sp.mutez(0),
                sp.contract(
                    t_transfer_batch, offer.collection, entrypoint="transfer"
                ).unwrap_some(error="BAD_COLLECTION"),
            )
            # Split the sale: platform fee, then royalties read
            # from the collection itself, then whatever is left to
            # the seller. Royalties never come from the listing, so
            # a seller cannot zero out the artist's share.
            fee = sp.split_tokens(offer.amount, offer.fee_bps, 10000)
            self.data.fees_accrued += fee
            remaining = offer.amount - fee

            # A collection we did not deploy can say anything here, and a
            # hostile one could claim 100% and take the seller's proceeds
            #, or claim more than is left and make every sale of its
            # tokens fail. So the total honoured is clamped: shares are
            # paid in order until the cap is reached, and anything past it
            # is ignored rather than trusted. Our own collections cap at
            # the same figure when they are deployed, so this changes
            # nothing for them and protects sellers of everything else.
            royalties = sp.view(
                "get_royalties", offer.collection, (), sp.map[sp.address, sp.nat]
            )
            if royalties.is_some():
                budget = sp.cast(2500, sp.nat)
                for recipient in royalties.unwrap_some().items():
                    share = recipient.value
                    if share > budget:
                        share = budget
                    budget = sp.as_nat(budget - share)
                    cut = sp.split_tokens(offer.amount, share, 10000)
                    if cut > sp.mutez(0):
                        remaining -= cut
                        sp.send(recipient.key, cut)

            if remaining > sp.mutez(0):
                sp.send(sp.sender, remaining)

            sp.emit(
                sp.record(
                    offer_id=offer_id,
                    collection=offer.collection,
                    token_id=offer.token_id,
                    seller=sp.sender,
                    buyer=offer.buyer,
                    price=offer.amount,
                ),
                tag="sale",
            )

        # --- administration ---

        @sp.entrypoint
        def set_fee(self, fee_bps):
            """(Admin only) The platform's cut of future sales.

            Capped by the contract so no future administrator can turn it
            into a toll, and never retroactive: live listings and offers
            settle on the fee they were created with.
            """
            sp.cast(fee_bps, sp.nat)
            assert sp.amount == sp.mutez(0), "TEZ_NOT_ACCEPTED"
            assert self.is_administrator_(), "NOT_ADMIN"
            assert fee_bps <= 1000, "FEE_TOO_HIGH"
            self.data.fee_bps = fee_bps
            sp.emit(sp.record(fee_bps=fee_bps), tag="set_fee")

        @sp.entrypoint
        def set_treasury(self, treasury):
            sp.cast(treasury, sp.address)
            assert sp.amount == sp.mutez(0), "TEZ_NOT_ACCEPTED"
            assert self.is_administrator_(), "NOT_ADMIN"
            self.data.treasury = treasury

        @sp.entrypoint
        def set_paused(self, new_state):
            """(Admin only) Stop new listings, offers and purchases.

            Delisting and cancelling stay open, so a pause never traps a
            token or someone's tez in here.
            """
            sp.cast(new_state, sp.bool)
            assert sp.amount == sp.mutez(0), "TEZ_NOT_ACCEPTED"
            assert self.is_administrator_(), "NOT_ADMIN"
            self.data.paused = new_state
            sp.emit(sp.record(paused=new_state), tag="set_paused")

        @sp.entrypoint
        def withdraw_fees(self):
            """(Anyone) Sweep accrued fees to the treasury.

            Fees accrue rather than being forwarded during a sale, so a
            treasury address that rejects transfers cannot break trading.
            Permissionless because the destination is fixed in storage.
            """
            assert sp.amount == sp.mutez(0), "TEZ_NOT_ACCEPTED"
            # Never more than the contract holds. Royalties owed and offers in
            # escrow are also in this balance, so the accrued figure is what
            # is claimable and the balance is the hard ceiling.
            amount = self.data.fees_accrued
            if amount > sp.balance:
                amount = sp.balance
            assert amount > sp.mutez(0), "NOTHING_TO_WITHDRAW"
            self.data.fees_accrued = sp.mutez(0)
            sp.send(self.data.treasury, amount)
            sp.emit(sp.record(amount=amount), tag="withdraw_fees")

        @sp.entrypoint
        def propose_admin(self, new_admin):
            sp.cast(new_admin, sp.address)
            assert sp.amount == sp.mutez(0), "TEZ_NOT_ACCEPTED"
            assert self.is_administrator_(), "NOT_ADMIN"
            self.data.proposed_admin = sp.Some(new_admin)

        @sp.entrypoint
        def accept_admin(self):
            assert sp.amount == sp.mutez(0), "TEZ_NOT_ACCEPTED"
            assert self.data.proposed_admin == sp.Some(
                sp.sender
            ), "NOT_PROPOSED_ADMIN"
            self.data.administrator = sp.sender
            self.data.proposed_admin = None

        # --- views ---

        @sp.onchain_view()
        def get_listing(self, listing_id):
            sp.cast(listing_id, sp.nat)
            return self.data.listings.get(listing_id, error="NO_LISTING")

        @sp.onchain_view()
        def get_offer(self, offer_id):
            sp.cast(offer_id, sp.nat)
            return self.data.offers.get(offer_id, error="NO_OFFER")
