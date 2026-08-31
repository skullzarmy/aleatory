"""Test suite for `marketplace.py`. Run:

    SMARTPY_OUTPUT_DIR=contract/output-marketplace python3 contract/tests_marketplace.py

Exit 0 means every scenario passed.
"""

import sys, os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import smartpy as sp
from marketplace import marketplace
from fa2_testing import fa2_testing, fa2


# === Tests ===
#
# The marketplace is tested against a stub FA2 rather than the real
# collection, so a failure here is a marketplace failure and not a
# collection one. The stub exposes `get_royalties` exactly as a collection
# does, plus a variant that exposes nothing, because "an ordinary FA2 with
# no royalties view still trades" is part of the contract.

_META = sp.big_map({"": sp.bytes("0x00")})


@sp.module
def stub():
    class StubFa2(sp.Contract):
        """Minimal FA2 with an optional royalties view."""

        def __init__(self, royalties):
            self.data.ledger = sp.cast(
                sp.big_map(), sp.big_map[sp.nat, sp.address]
            )
            self.data.royalties = sp.cast(
                royalties, sp.map[sp.address, sp.nat]
            )

        @sp.entrypoint
        def mint(self, to_, token_id):
            self.data.ledger[token_id] = to_

        @sp.entrypoint
        def transfer(self, batch):
            sp.cast(
                batch,
                sp.list[
                    sp.record(
                        from_=sp.address,
                        txs=sp.list[
                            sp.record(
                                to_=sp.address,
                                token_id=sp.nat,
                                amount=sp.nat,
                            ).layout(("to_", ("token_id", "amount")))
                        ],
                    ).layout(("from_", "txs"))
                ],
            )
            for t in batch:
                for tx in t.txs:
                    assert self.data.ledger[tx.token_id] == t.from_, "FA2_NOT_OWNER"
                    self.data.ledger[tx.token_id] = tx.to_

        @sp.onchain_view()
        def get_royalties(self):
            return self.data.royalties

    class Sink(sp.Contract):
        """A contract that accepts a plain transfer, like a split contract."""

        @sp.entrypoint
        def default(self):
            pass

    class PlainFa2(sp.Contract):
        """The same, with no royalties view at all."""

        def __init__(self):
            self.data.ledger = sp.cast(
                sp.big_map(), sp.big_map[sp.nat, sp.address]
            )

        @sp.entrypoint
        def mint(self, to_, token_id):
            self.data.ledger[token_id] = to_

        @sp.entrypoint
        def transfer(self, batch):
            sp.cast(
                batch,
                sp.list[
                    sp.record(
                        from_=sp.address,
                        txs=sp.list[
                            sp.record(
                                to_=sp.address,
                                token_id=sp.nat,
                                amount=sp.nat,
                            ).layout(("to_", ("token_id", "amount")))
                        ],
                    ).layout(("from_", "txs"))
                ],
            )
            for t in batch:
                for tx in t.txs:
                    assert self.data.ledger[tx.token_id] == t.from_, "FA2_NOT_OWNER"
                    self.data.ledger[tx.token_id] = tx.to_


def _market(scenario, admin, treasury, fee_bps=250):
    m = marketplace.AleatoryMarketplace(
        administrator=admin.address,
        treasury=treasury.address,
        fee_bps=fee_bps,
        metadata=_META,
    )
    scenario += m
    return m


@sp.add_test()
def test_list_buy_and_split():
    """A sale pays the platform, then the artists, then the seller, and
    the royalty numbers come from the collection, not the listing."""
    scenario = sp.test_scenario("Sale", [stub, marketplace])
    admin = sp.test_account("Admin")
    treasury = sp.test_account("Treasury")
    artist = sp.test_account("Artist")
    collab = sp.test_account("Collaborator")
    alice = sp.test_account("Alice")
    bob = sp.test_account("Bob")

    fa2 = stub.StubFa2({artist.address: 1000, collab.address: 250})
    scenario += fa2
    fa2.mint(sp.record(to_=alice.address, token_id=0))

    m = _market(scenario, admin, treasury)

    m.list_token(
        sp.record(
            collection=fa2.address, token_id=0, price=sp.mutez(10_000_000)
        ),
        _sender=alice,
    )
    # The token is escrowed, so a listing can never go stale.
    scenario.verify(fa2.data.ledger[0] == m.address)

    m.buy(0, _sender=bob, _amount=sp.mutez(9_000_000), _valid=False)
    m.buy(0, _sender=bob, _amount=sp.mutez(10_000_000))

    scenario.verify(fa2.data.ledger[0] == bob.address)
    # 2.5% of 10 tez.
    scenario.verify(m.data.fees_accrued == sp.mutez(250_000))

    # Everyone is paid in the sale itself: the artist's 10%, the collab's
    # 2.5%, and the seller's remainder. Nothing is left owed to anybody and
    # there is nothing for an artist to know to claim.
    scenario.verify(m.balance == sp.mutez(250_000))

    # So the balance is the fee and only the fee.
    m.withdraw_fees(_sender=bob)
    scenario.verify(m.data.fees_accrued == sp.mutez(0))
    scenario.verify(m.balance == sp.mutez(0))


@sp.add_test()
def test_seller_cannot_zero_out_royalties():
    """The whole reason royalties are on chain. A listing carries no
    royalty information at all, so there is nothing for a seller to lie
    about."""
    scenario = sp.test_scenario("Royalty enforcement", [stub, marketplace])
    admin = sp.test_account("Admin")
    treasury = sp.test_account("Treasury")
    artist = sp.test_account("Artist")
    alice = sp.test_account("Alice")
    bob = sp.test_account("Bob")

    fa2 = stub.StubFa2({artist.address: 2500})
    scenario += fa2
    fa2.mint(sp.record(to_=alice.address, token_id=0))
    m = _market(scenario, admin, treasury)

    m.list_token(
        sp.record(
            collection=fa2.address, token_id=0, price=sp.mutez(4_000_000)
        ),
        _sender=alice,
    )
    m.buy(0, _sender=bob, _amount=sp.mutez(4_000_000))

    # 2.5% platform, 25% royalty, and the artist is paid whatever the
    # seller wanted.
    scenario.verify(m.data.fees_accrued == sp.mutez(100_000))
    scenario.verify(fa2.data.ledger[0] == bob.address)


@sp.add_test()
def test_plain_fa2_without_royalties_still_trades():
    """A collection that exposes no royalties view pays none, rather than
    failing, which is what lets this market carry ordinary FA2s too."""
    scenario = sp.test_scenario("Plain FA2", [stub, marketplace])
    admin = sp.test_account("Admin")
    treasury = sp.test_account("Treasury")
    alice = sp.test_account("Alice")
    bob = sp.test_account("Bob")

    fa2 = stub.PlainFa2()
    scenario += fa2
    fa2.mint(sp.record(to_=alice.address, token_id=0))
    m = _market(scenario, admin, treasury)

    m.list_token(
        sp.record(
            collection=fa2.address, token_id=0, price=sp.mutez(1_000_000)
        ),
        _sender=alice,
    )
    m.buy(0, _sender=bob, _amount=sp.mutez(1_000_000))
    scenario.verify(fa2.data.ledger[0] == bob.address)
    scenario.verify(m.data.fees_accrued == sp.mutez(25_000))


@sp.add_test()
def test_delist_returns_the_token():
    scenario = sp.test_scenario("Delist", [stub, marketplace])
    admin = sp.test_account("Admin")
    treasury = sp.test_account("Treasury")
    alice = sp.test_account("Alice")
    bob = sp.test_account("Bob")

    fa2 = stub.StubFa2({})
    scenario += fa2
    fa2.mint(sp.record(to_=alice.address, token_id=0))
    m = _market(scenario, admin, treasury)

    m.list_token(
        sp.record(
            collection=fa2.address, token_id=0, price=sp.mutez(1_000_000)
        ),
        _sender=alice,
    )
    m.delist(0, _sender=bob, _valid=False)
    m.delist(0, _sender=alice)
    scenario.verify(fa2.data.ledger[0] == alice.address)
    m.buy(0, _sender=bob, _amount=sp.mutez(1_000_000), _valid=False)


@sp.add_test()
def test_offers():
    """Offered tez is escrowed, so an accepted offer can always be paid."""
    scenario = sp.test_scenario("Offers", [stub, marketplace])
    admin = sp.test_account("Admin")
    treasury = sp.test_account("Treasury")
    artist = sp.test_account("Artist")
    alice = sp.test_account("Alice")
    bob = sp.test_account("Bob")

    fa2 = stub.StubFa2({artist.address: 1000})
    scenario += fa2
    fa2.mint(sp.record(to_=alice.address, token_id=0))
    m = _market(scenario, admin, treasury)

    m.make_offer(
        sp.record(collection=fa2.address, token_id=0),
        _sender=bob,
        _amount=sp.mutez(0),
        _valid=False,
    )
    m.make_offer(
        sp.record(collection=fa2.address, token_id=0),
        _sender=bob,
        _amount=sp.mutez(2_000_000),
    )
    scenario.verify(m.balance == sp.mutez(2_000_000))

    # Only the offerer can withdraw it.
    m.cancel_offer(0, _sender=alice, _valid=False)

    # The holder sells into it.
    m.accept_offer(0, _sender=alice)
    scenario.verify(fa2.data.ledger[0] == bob.address)
    scenario.verify(m.data.fees_accrued == sp.mutez(50_000))

    # Someone who does not hold the token cannot accept.
    m.make_offer(
        sp.record(collection=fa2.address, token_id=0),
        _sender=alice,
        _amount=sp.mutez(1_000_000),
    )
    m.accept_offer(1, _sender=alice, _valid=False)
    m.accept_offer(1, _sender=bob)


@sp.add_test()
def test_cancel_offer_refunds():
    scenario = sp.test_scenario("Cancel offer", [stub, marketplace])
    admin = sp.test_account("Admin")
    treasury = sp.test_account("Treasury")
    alice = sp.test_account("Alice")
    bob = sp.test_account("Bob")

    fa2 = stub.StubFa2({})
    scenario += fa2
    fa2.mint(sp.record(to_=alice.address, token_id=0))
    m = _market(scenario, admin, treasury)

    m.make_offer(
        sp.record(collection=fa2.address, token_id=0),
        _sender=bob,
        _amount=sp.mutez(3_000_000),
    )
    m.cancel_offer(0, _sender=bob)
    scenario.verify(m.balance == sp.mutez(0))
    m.accept_offer(0, _sender=alice, _valid=False)


@sp.add_test()
def test_fee_is_never_retroactive_and_is_capped():
    """A live listing settles on the fee it was created with."""
    scenario = sp.test_scenario("Fee changes", [stub, marketplace])
    admin = sp.test_account("Admin")
    treasury = sp.test_account("Treasury")
    alice = sp.test_account("Alice")
    bob = sp.test_account("Bob")

    fa2 = stub.StubFa2({})
    scenario += fa2
    fa2.mint(sp.record(to_=alice.address, token_id=0))
    m = _market(scenario, admin, treasury)

    m.list_token(
        sp.record(
            collection=fa2.address, token_id=0, price=sp.mutez(10_000_000)
        ),
        _sender=alice,
    )

    m.set_fee(500, _sender=alice, _valid=False)
    m.set_fee(1001, _sender=admin, _valid=False)  # ceiling
    m.set_fee(500, _sender=admin)

    # Still settles at 2.5%, the fee in force when it was listed.
    m.buy(0, _sender=bob, _amount=sp.mutez(10_000_000))
    scenario.verify(m.data.fees_accrued == sp.mutez(250_000))


@sp.add_test()
def test_pause_never_traps_anyone():
    """Pausing stops new trading. It must not lock a token or someone's
    tez inside this contract."""
    scenario = sp.test_scenario("Pause", [stub, marketplace])
    admin = sp.test_account("Admin")
    treasury = sp.test_account("Treasury")
    alice = sp.test_account("Alice")
    bob = sp.test_account("Bob")

    fa2 = stub.StubFa2({})
    scenario += fa2
    fa2.mint(sp.record(to_=alice.address, token_id=0))
    m = _market(scenario, admin, treasury)

    m.list_token(
        sp.record(
            collection=fa2.address, token_id=0, price=sp.mutez(1_000_000)
        ),
        _sender=alice,
    )
    m.make_offer(
        sp.record(collection=fa2.address, token_id=1),
        _sender=bob,
        _amount=sp.mutez(500_000),
    )

    m.set_paused(True, _sender=admin)
    m.buy(0, _sender=bob, _amount=sp.mutez(1_000_000), _valid=False)
    m.list_token(
        sp.record(
            collection=fa2.address, token_id=1, price=sp.mutez(1_000_000)
        ),
        _sender=alice,
        _valid=False,
    )

    # But the ways out stay open.
    m.delist(0, _sender=alice)
    m.cancel_offer(0, _sender=bob)
    scenario.verify(fa2.data.ledger[0] == alice.address)
    scenario.verify(m.balance == sp.mutez(0))


@sp.add_test()
def test_hostile_collection_cannot_take_the_sellers_proceeds():
    """A collection we did not deploy can claim any royalty it likes. The
    marketplace honours at most a quarter, so a hostile one can neither
    drain a seller nor make its tokens untradeable."""
    scenario = sp.test_scenario("Hostile royalties", [stub, marketplace])
    admin = sp.test_account("Admin")
    treasury = sp.test_account("Treasury")
    greedy = sp.test_account("Greedy")
    alice = sp.test_account("Alice")
    bob = sp.test_account("Bob")

    # Claims the entire sale price as royalty.
    fa2 = stub.StubFa2({greedy.address: 10000})
    scenario += fa2
    fa2.mint(sp.record(to_=alice.address, token_id=0))
    m = _market(scenario, admin, treasury)

    m.list_token(
        sp.record(
            collection=fa2.address, token_id=0, price=sp.mutez(4_000_000)
        ),
        _sender=alice,
    )
    # The sale still completes, rather than failing on an underflow.
    m.buy(0, _sender=bob, _amount=sp.mutez(4_000_000))
    scenario.verify(fa2.data.ledger[0] == bob.address)
    scenario.verify(m.data.fees_accrued == sp.mutez(100_000))
    # It asked for 100% and was paid 25%, the cap. The seller kept the rest,
    # so the fee is all that stays behind.
    scenario.verify(m.balance == sp.mutez(100_000))


@sp.add_test()
def test_admin_surface():
    scenario = sp.test_scenario("Admin", [stub, marketplace])
    admin = sp.test_account("Admin")
    treasury = sp.test_account("Treasury")
    new_admin = sp.test_account("NewAdmin")
    alice = sp.test_account("Alice")
    m = _market(scenario, admin, treasury)

    m.propose_admin(new_admin.address, _sender=alice, _valid=False)
    m.propose_admin(new_admin.address, _sender=admin)
    m.accept_admin(_sender=admin, _valid=False)
    m.accept_admin(_sender=new_admin)
    scenario.verify(m.data.administrator == new_admin.address)
    m.set_paused(True, _sender=admin, _valid=False)
    m.set_paused(True, _sender=new_admin)


@sp.add_test()
def test_royalties_are_paid_in_the_sale():
    """Every recipient is paid in the buy operation, so what the contract
    holds afterwards is the fee and nothing else. An artist never has money
    sitting here waiting on them to know it exists.

    A recipient that cannot take a plain transfer is skipped, and its share
    goes to the seller. ALEATORY-001 section 1 asks a front end to check
    royalty addresses before they become immutable, so a skipped share is a
    misconfiguration caught at publishing time."""
    scenario = sp.test_scenario("Royalties are paid", [stub, marketplace])
    admin = sp.test_account("Admin")
    treasury = sp.test_account("Treasury")
    artist = sp.test_account("Artist")
    collab = sp.test_account("Collaborator")
    alice = sp.test_account("Alice")
    bob = sp.test_account("Bob")

    fa2 = stub.StubFa2({artist.address: 1000, collab.address: 250})
    scenario += fa2
    fa2.mint(sp.record(to_=alice.address, token_id=0))

    m = _market(scenario, admin, treasury)
    m.list_token(
        sp.record(collection=fa2.address, token_id=0, price=sp.mutez(10_000_000)),
        _sender=alice,
    )
    m.buy(0, _sender=bob, _amount=sp.mutez(10_000_000))

    # 2.5% fee, 10% artist, 2.5% collab, 85% seller. Only the fee is held.
    scenario.verify(m.data.fees_accrued == sp.mutez(250_000))
    scenario.verify(m.balance == sp.mutez(250_000))

    # Sweeping empties it, which is the invariant: what a marketplace holds
    # is its own fee and live offer escrow, never somebody else's royalties.
    m.withdraw_fees(_sender=bob)
    scenario.verify(m.balance == sp.mutez(0))


@sp.add_test()
def test_contract_recipient_with_default_entrypoint_is_paid():
    """A KT1 royalty recipient that accepts a plain transfer, a split
    contract for a collaboration, is paid inside the sale like anyone
    else, on both settlement paths."""
    scenario = sp.test_scenario("Payable contract recipient", [stub, marketplace])
    admin = sp.test_account("Admin")
    treasury = sp.test_account("Treasury")
    alice = sp.test_account("Alice")
    bob = sp.test_account("Bob")

    sink = stub.Sink()
    scenario += sink
    fa2 = stub.StubFa2({sink.address: 1000})
    scenario += fa2
    fa2.mint(sp.record(to_=alice.address, token_id=0))
    m = _market(scenario, admin, treasury)

    m.list_token(
        sp.record(
            collection=fa2.address, token_id=0, price=sp.mutez(10_000_000)
        ),
        _sender=alice,
    )
    m.buy(0, _sender=bob, _amount=sp.mutez(10_000_000))
    # 10% of the sale went to the contract, and only the fee stayed here.
    scenario.verify(sink.balance == sp.mutez(1_000_000))
    scenario.verify(m.balance == sp.mutez(250_000))

    # The same through an offer.
    m.make_offer(
        sp.record(collection=fa2.address, token_id=0),
        _sender=alice,
        _amount=sp.mutez(2_000_000),
    )
    m.accept_offer(0, _sender=bob)
    scenario.verify(sink.balance == sp.mutez(1_200_000))


@sp.add_test()
def test_unpayable_recipient_never_blocks_a_sale():
    """A royalty address that cannot take a plain transfer is skipped, and
    its share stays with the seller.

    The royalty map has no setter, so an address written by accident is
    written forever. Reverting on it would make every token in the
    collection unsellable here permanently. Skipping costs that recipient
    an unenforceable royalty, which is the failure ALEATORY-001 section 1
    asks a front end to catch before publishing."""
    scenario = sp.test_scenario("Unpayable recipient", [stub, marketplace])
    admin = sp.test_account("Admin")
    treasury = sp.test_account("Treasury")
    artist = sp.test_account("Artist")
    alice = sp.test_account("Alice")
    bob = sp.test_account("Bob")

    # A contract with no default entrypoint: it cannot receive tez.
    unpayable = stub.PlainFa2()
    scenario += unpayable
    fa2 = stub.StubFa2({unpayable.address: 1000, artist.address: 500})
    scenario += fa2
    fa2.mint(sp.record(to_=alice.address, token_id=0))
    m = _market(scenario, admin, treasury)

    m.list_token(
        sp.record(
            collection=fa2.address, token_id=0, price=sp.mutez(10_000_000)
        ),
        _sender=alice,
    )
    # The sale completes. The artist's 5% is paid, the unpayable 10% goes
    # to the seller with the rest, and the fee is all that stays behind.
    m.buy(0, _sender=bob, _amount=sp.mutez(10_000_000))
    scenario.verify(fa2.data.ledger[0] == bob.address)
    scenario.verify(unpayable.balance == sp.mutez(0))
    scenario.verify(m.balance == sp.mutez(250_000))

    # The same through an offer.
    m.make_offer(
        sp.record(collection=fa2.address, token_id=0),
        _sender=alice,
        _amount=sp.mutez(2_000_000),
    )
    m.accept_offer(0, _sender=bob)
    scenario.verify(fa2.data.ledger[0] == alice.address)
    scenario.verify(unpayable.balance == sp.mutez(0))
    scenario.verify(m.balance == sp.mutez(300_000))


@sp.add_test()
def test_full_fa2_operator_dance():
    """The marketplace's escrow works against a standards-compliant FA2.

    The stubs skip the operator layer, so they cannot answer this: a real
    TZIP-12 token refuses a transfer from anyone who is neither owner nor
    operator. Listing must therefore fail without a grant, succeed with one,
    and settle a sale exactly as it does for the stubs, royalties included."""
    scenario = sp.test_scenario(
        "Full FA2", [fa2.t, fa2.main, fa2_testing, marketplace]
    )
    admin = sp.test_account("Admin")
    treasury = sp.test_account("Treasury")
    artist = sp.test_account("Artist")
    alice = sp.test_account("Alice")
    bob = sp.test_account("Bob")

    token = fa2_testing.FullFa2(
        artist.address,
        sp.big_map(),
        {0: alice.address},
        [fa2.make_metadata(name="Piece", decimals=0, symbol="TP0")],
        {artist.address: 1000},
    )
    scenario += token
    m = _market(scenario, admin, treasury)

    # A compliant token refuses the escrow without an operator grant.
    m.list_token(
        sp.record(
            collection=token.address, token_id=0, price=sp.mutez(4_000_000)
        ),
        _sender=alice,
        _valid=False,
        _exception="FA2_NOT_OPERATOR",
    )

    # Grant, list, revoke: the dance the front end batches.
    token.update_operators(
        [
            sp.variant.add_operator(
                sp.record(owner=alice.address, operator=m.address, token_id=0)
            )
        ],
        _sender=alice,
    )
    m.list_token(
        sp.record(
            collection=token.address, token_id=0, price=sp.mutez(4_000_000)
        ),
        _sender=alice,
    )
    scenario.verify(token.data.ledger[0] == m.address)
    token.update_operators(
        [
            sp.variant.remove_operator(
                sp.record(owner=alice.address, operator=m.address, token_id=0)
            )
        ],
        _sender=alice,
    )

    # Settlement is identical to the stubs: fee held, artist paid inline.
    m.buy(0, _sender=bob, _amount=sp.mutez(4_000_000))
    scenario.verify(token.data.ledger[0] == bob.address)
    scenario.verify(m.data.fees_accrued == sp.mutez(100_000))
    scenario.verify(m.balance == sp.mutez(100_000))
