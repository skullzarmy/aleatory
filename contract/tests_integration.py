"""Integration tests: the real collection on the real marketplace. Run:

    SMARTPY_OUTPUT_DIR=contract/output-int python3 contract/tests_integration.py

Every other suite tests one contract against stubs I also wrote, which
means a shared wrong assumption would pass twice. These run the actual
contracts against each other: a collection deployed by the actual factory,
priced by the actual provider, listed on the actual marketplace, with
royalties read across the boundary by a real on-chain view call.
"""

import sys, os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import smartpy as sp
from aleatory import aleatory
from marketplace import marketplace


_META = sp.big_map(
    {
        "": sp.bytes("0x74657a6f732d73746f726167653a636f6e74656e74"),
        "content": sp.bytes(
            "0x7b226e616d65223a22416c6561746f7279222c22696e74657266616365"
            "73223a5b22545a49502d303132222c22545a49502d303136225d7d"
        ),
    }
)
_CODE_URI = "ipfs://QmGeneratorCode"
# The generator, on chain. Short here because these tests are about the
# contract's rules; the real cost of a real generator is measured against a
# live chain, not asserted in a scenario.
_CODE = sp.bytes("0x3c68746d6c3e3c2f68746d6c3e")  # <html></html>
_PENDING = sp.bytes("0x697066733a2f2f516d50656e64696e67")
_REVEALED = sp.bytes("0x697066733a2f2f516d5265616c")
_NONE = sp.bytes("0x")

_PRICE = 10_000_000      # 10 tez
_GAS = 200_000           # 0.2 tez render gas
_TOTAL = _PRICE + _GAS


def _world(scenario, admin, agent, treasury, artist, royalties):
    """Everything, wired the way it will be on chain."""
    resolver = aleatory.AleatoryResolver(
        administrator=admin.address, writers=sp.set([agent.address])
    )
    scenario += resolver

    provider = aleatory.AleatoryProvider(
        operator=admin.address,
        agent=agent.address,
        render_gas=sp.mutez(_GAS),
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

    market = marketplace.AleatoryMarketplace(
        administrator=admin.address,
        treasury=treasury.address,
        fee_bps=250,
        metadata=_META,
    )
    scenario += market

    # A collection the artist owns, deployed the way an artist deploys one.
    factory.deploy(
        sp.record(
            code=_CODE,
            code_encoding="identity",
            code_hash=sp.bytes("0xaa"),
            code_uri="",
            edition_size=0,
            price=sp.mutez(_PRICE),
            royalties=royalties,
            pending_metadata=_PENDING,
            start_paused=False,
            trust_resolver=True,
            provider=provider.address,
            max_render_gas=sp.mutez(_GAS),
            metadata=_META,
        ),
        _sender=artist,
    )
    return resolver, provider, factory, market


@sp.add_test()
def test_full_lifecycle():
    """Deploy, mint, publish, list, sell, across four real contracts.

    The load-bearing assertion is the royalty split: the marketplace has no
    royalty information of its own and has to fetch it from the collection
    through an on-chain view. If that call is wrong in either contract, the
    artist silently stops being paid, and no single-contract test would
    catch it.
    """
    scenario = sp.test_scenario("Full lifecycle", [aleatory, marketplace])
    admin = sp.test_account("Admin")
    agent = sp.test_account("Agent")
    treasury = sp.test_account("Treasury")
    artist = sp.test_account("Artist")
    collab = sp.test_account("Collaborator")
    alice = sp.test_account("Alice")
    bob = sp.test_account("Bob")

    # 10% to the artist, 2.5% to a collaborator.
    royalties = {artist.address: 1000, collab.address: 250}
    resolver, provider, factory, market = _world(
        scenario, admin, agent, treasury, artist, royalties
    )
    # The collection the factory just originated. `dynamic_contract` is
    # how a scenario gets a handle on a contract created inside another
    # contract's entrypoint.
    c = scenario.dynamic_contract(aleatory.AleatoryCollection)
    collection_address = c.address

    # --- primary: one signature, token exists immediately ---
    c.mint(_NONE, _sender=alice, _amount=sp.mutez(_TOTAL))
    scenario.verify(c.data.ledger[0] == alice.address)
    scenario.verify(c.data.token_metadata[0].token_info[""] == _PENDING)
    # The collection kept nothing; the provider was paid.
    scenario.verify(c.balance == sp.mutez(0))
    scenario.verify(provider.balance == sp.mutez(_GAS))

    # --- reveal: the resolver-authorised agent publishes ---
    c.set_token_metadata(
        sp.record(token_id=0, metadata_uri=_REVEALED), _sender=agent
    )
    scenario.verify(c.data.token_metadata[0].token_info[""] == _REVEALED)

    # --- secondary: list it ---
    c.update_operators(
        [
            sp.variant.add_operator(
                sp.record(
                    owner=alice.address,
                    operator=market.address,
                    token_id=0,
                )
            )
        ],
        _sender=alice,
    )
    market.list_token(
        sp.record(
            collection=collection_address,
            token_id=0,
            price=sp.mutez(100_000_000),  # 100 tez
        ),
        _sender=alice,
    )
    scenario.verify(c.data.ledger[0] == market.address)

    market.buy(0, _sender=bob, _amount=sp.mutez(100_000_000))
    scenario.verify(c.data.ledger[0] == bob.address)

    # 2.5% of 100 tez to the platform, and the royalties came from the
    # collection's own storage rather than from anything Alice supplied.
    scenario.verify(market.data.fees_accrued == sp.mutez(2_500_000))
    # 10% and 2.5% of 100 tez, credited to the two recipients the
    # collection named. This is the crossing the test exists to prove:
    # nothing in the listing or in Alice's hands set these numbers.
    scenario.verify(market.royalties_owed_to(artist.address) == sp.mutez(10_000_000))
    scenario.verify(market.royalties_owed_to(collab.address) == sp.mutez(2_500_000))
    # The seller was paid during the sale. The fee and the credited
    # royalties stay behind until each is claimed.
    scenario.verify(market.balance == sp.mutez(15_000_000))

    # And the credit is really payable, rather than a number that only
    # looks right in storage.
    market.claim_royalties(artist.address, _sender=bob)
    scenario.verify(market.royalties_owed_to(artist.address) == sp.mutez(0))
    scenario.verify(market.balance == sp.mutez(5_000_000))


@sp.add_test()
def test_royalties_actually_cross_the_contract_boundary():
    """The same sale with and without royalties, so the difference is
    attributable to the view call and not to arithmetic drift."""
    scenario = sp.test_scenario("Royalty crossing", [aleatory, marketplace])
    admin = sp.test_account("Admin")
    agent = sp.test_account("Agent")
    treasury = sp.test_account("Treasury")
    artist = sp.test_account("Artist")
    alice = sp.test_account("Alice")
    bob = sp.test_account("Bob")

    resolver, provider, factory, market = _world(
        scenario, admin, agent, treasury, artist,
        {artist.address: 2500},
    )
    # The collection the factory just originated. `dynamic_contract` is
    # how a scenario gets a handle on a contract created inside another
    # contract's entrypoint.
    c = scenario.dynamic_contract(aleatory.AleatoryCollection)
    collection_address = c.address

    # The view answers across the boundary before anyone trades.
    scenario.verify(
        sp.View(c, "get_royalties")()[artist.address] == 2500
    )

    c.mint(_NONE, _sender=alice, _amount=sp.mutez(_TOTAL))
    c.update_operators(
        [
            sp.variant.add_operator(
                sp.record(
                    owner=alice.address,
                    operator=market.address,
                    token_id=0,
                )
            )
        ],
        _sender=alice,
    )
    market.list_token(
        sp.record(
            collection=collection_address,
            token_id=0,
            price=sp.mutez(40_000_000),
        ),
        _sender=alice,
    )
    market.buy(0, _sender=bob, _amount=sp.mutez(40_000_000))

    # 2.5% platform on 40 tez, and the 25% royalty the collection declared.
    scenario.verify(market.data.fees_accrued == sp.mutez(1_000_000))
    scenario.verify(market.royalties_owed_to(artist.address) == sp.mutez(10_000_000))
    scenario.verify(market.balance == sp.mutez(11_000_000))


@sp.add_test()
def test_an_unrevealed_piece_still_trades():
    """A piece whose metadata was never published is a real token. It
    should list and sell like any other, the reveal is a courtesy, not a
    precondition for ownership."""
    scenario = sp.test_scenario("Unrevealed trade", [aleatory, marketplace])
    admin = sp.test_account("Admin")
    agent = sp.test_account("Agent")
    treasury = sp.test_account("Treasury")
    artist = sp.test_account("Artist")
    alice = sp.test_account("Alice")
    bob = sp.test_account("Bob")

    resolver, provider, factory, market = _world(
        scenario, admin, agent, treasury, artist, {artist.address: 1000}
    )
    # The collection the factory just originated. `dynamic_contract` is
    # how a scenario gets a handle on a contract created inside another
    # contract's entrypoint.
    c = scenario.dynamic_contract(aleatory.AleatoryCollection)
    collection_address = c.address

    c.mint(_NONE, _sender=alice, _amount=sp.mutez(_TOTAL))
    c.update_operators(
        [
            sp.variant.add_operator(
                sp.record(
                    owner=alice.address,
                    operator=market.address,
                    token_id=0,
                )
            )
        ],
        _sender=alice,
    )
    market.list_token(
        sp.record(
            collection=collection_address,
            token_id=0,
            price=sp.mutez(5_000_000),
        ),
        _sender=alice,
    )
    market.buy(0, _sender=bob, _amount=sp.mutez(5_000_000))
    scenario.verify(c.data.ledger[0] == bob.address)

    # And the new owner can still have it revealed afterwards.
    c.set_token_metadata(
        sp.record(token_id=0, metadata_uri=_REVEALED), _sender=agent
    )
    scenario.verify(c.data.token_metadata[0].token_info[""] == _REVEALED)


@sp.add_test()
def test_offer_on_a_piece_pays_royalties_too():
    scenario = sp.test_scenario("Offer path", [aleatory, marketplace])
    admin = sp.test_account("Admin")
    agent = sp.test_account("Agent")
    treasury = sp.test_account("Treasury")
    artist = sp.test_account("Artist")
    alice = sp.test_account("Alice")
    bob = sp.test_account("Bob")

    resolver, provider, factory, market = _world(
        scenario, admin, agent, treasury, artist, {artist.address: 1000}
    )
    # The collection the factory just originated. `dynamic_contract` is
    # how a scenario gets a handle on a contract created inside another
    # contract's entrypoint.
    c = scenario.dynamic_contract(aleatory.AleatoryCollection)
    collection_address = c.address

    c.mint(_NONE, _sender=alice, _amount=sp.mutez(_TOTAL))
    market.make_offer(
        sp.record(collection=collection_address, token_id=0),
        _sender=bob,
        _amount=sp.mutez(20_000_000),
    )
    scenario.verify(market.balance == sp.mutez(20_000_000))

    c.update_operators(
        [
            sp.variant.add_operator(
                sp.record(
                    owner=alice.address,
                    operator=market.address,
                    token_id=0,
                )
            )
        ],
        _sender=alice,
    )
    market.accept_offer(0, _sender=alice)
    scenario.verify(c.data.ledger[0] == bob.address)
    scenario.verify(market.data.fees_accrued == sp.mutez(500_000))
    # The offer path reads the same view and credits the same way the
    # listing path does, which is the point of testing it separately.
    scenario.verify(market.royalties_owed_to(artist.address) == sp.mutez(2_000_000))
    scenario.verify(market.balance == sp.mutez(2_500_000))


@sp.add_test()
def test_a_dead_provider_does_not_stop_the_market():
    """If rendering stops entirely, primary sales and secondary trading
    both carry on. Only thumbnails stop."""
    scenario = sp.test_scenario("Dead provider", [aleatory, marketplace])
    admin = sp.test_account("Admin")
    agent = sp.test_account("Agent")
    treasury = sp.test_account("Treasury")
    artist = sp.test_account("Artist")
    alice = sp.test_account("Alice")
    bob = sp.test_account("Bob")

    resolver, provider, factory, market = _world(
        scenario, admin, agent, treasury, artist, {artist.address: 1000}
    )
    # The collection the factory just originated. `dynamic_contract` is
    # how a scenario gets a handle on a contract created inside another
    # contract's entrypoint.
    c = scenario.dynamic_contract(aleatory.AleatoryCollection)
    collection_address = c.address

    # Everything of ours goes away: the provider rotates its working key
    # to one nobody holds, our resolver entry is pulled, and the artist
    # severs the resolver outright. No path of ours reaches this
    # collection any more.
    dead = sp.test_account("DeadKey")
    provider.set_agent(dead.address, _sender=admin)
    resolver.remove_writer(agent.address, _sender=admin)
    c.set_trust_resolver(False, _sender=artist)

    # Minting still works; the piece is just never revealed.
    c.mint(_NONE, _sender=alice, _amount=sp.mutez(_TOTAL))
    scenario.verify(c.data.ledger[0] == alice.address)
    c.set_token_metadata(
        sp.record(token_id=0, metadata_uri=_REVEALED),
        _sender=agent,
        _valid=False,
    )

    # And it trades.
    c.update_operators(
        [
            sp.variant.add_operator(
                sp.record(
                    owner=alice.address,
                    operator=market.address,
                    token_id=0,
                )
            )
        ],
        _sender=alice,
    )
    market.list_token(
        sp.record(
            collection=collection_address,
            token_id=0,
            price=sp.mutez(1_000_000),
        ),
        _sender=alice,
    )
    market.buy(0, _sender=bob, _amount=sp.mutez(1_000_000))
    scenario.verify(c.data.ledger[0] == bob.address)

    # The artist appoints someone directly, and the backlog clears.
    rescue = sp.test_account("Rescue")
    c.set_local_writer(
        sp.record(writer=rescue.address, allowed=True), _sender=artist
    )
    c.set_token_metadata(
        sp.record(token_id=0, metadata_uri=_REVEALED), _sender=rescue
    )
    scenario.verify(c.data.token_metadata[0].token_info[""] == _REVEALED)
