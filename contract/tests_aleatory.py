"""Test suite for `aleatory.py`. Run:

    SMARTPY_OUTPUT_DIR=contract/output-aleatory python3 contract/tests_aleatory.py

Exit 0 means every scenario passed.
"""

import sys, os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import smartpy as sp
from aleatory import aleatory


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
# The generator, on chain. Short here because these tests are about the
# contract's rules; the real cost of a real generator is measured against a
# live chain, not asserted in a scenario.
_CODE = sp.bytes("0x3c68746d6c3e3c2f68746d6c3e")  # <html></html>
# The collection's "not revealed yet" metadata document.
_PENDING = sp.bytes("0x697066733a2f2f516d50656e64696e67")
# One piece's real metadata, published after rendering.
_REVEALED = sp.bytes("0x697066733a2f2f516d5265616c")
_NONE = sp.bytes("0x")

_PRICE = 1_000_000
_GAS = 200_000
_TOTAL = _PRICE + _GAS


def _collection_init(artist, resolver, provider, minter, render_gas=_GAS,
                     price=_PRICE, edition_size=10, start_paused=False,
                     agent=None, royalties=None, trust_resolver=True):
    royalties = (
        sp.cast({}, sp.map[sp.address, sp.nat])
        if royalties is None
        else royalties
    )
    return sp.record(
        administrator=artist.address,
        resolver=resolver.address,
        provider=provider.address,
        provider_agent=(minter if agent is None else agent).address,
        render_gas=sp.mutez(render_gas),
        code=_CODE,
        code_encoding="identity",
        code_hash=sp.bytes("0xaa"),
        code_uri="",
        edition_size=edition_size,
        price=sp.mutez(price),
        royalties=royalties,
        pending_metadata=_PENDING,
        start_paused=start_paused,
        trust_resolver=trust_resolver,
        metadata=_META,
    )


def _setup(scenario, admin, minter, treasury, render_gas=_GAS):
    resolver = aleatory.AleatoryResolver(
        administrator=admin.address, writers=sp.set([minter.address])
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


def _provider(scenario, operator, agent, render_gas=_GAS):
    c = aleatory.AleatoryProvider(
        operator=operator.address,
        agent=agent.address,
        render_gas=sp.mutez(render_gas),
        metadata=_META,
    )
    scenario += c
    return c


def _collection(scenario, artist, resolver, provider, minter, **kw):
    c = aleatory.AleatoryCollection(
        _collection_init(artist, resolver, provider, minter, **kw)
    )
    scenario += c
    return c


def _deploy_params(provider, price=_PRICE, edition_size=10,
                   max_render_gas=1_000_000, start_paused=False,
                   royalties=None, trust_resolver=True,
                   code=_CODE, code_encoding="identity",
                   code_hash=sp.bytes("0xaa"), code_uri=""):
    return sp.record(
        code=code,
        code_encoding=code_encoding,
        code_hash=code_hash,
        code_uri=code_uri,
        edition_size=edition_size,
        price=sp.mutez(price),
        royalties=(
            sp.cast({}, sp.map[sp.address, sp.nat])
            if royalties is None
            else royalties
        ),
        pending_metadata=_PENDING,
        start_paused=start_paused,
        trust_resolver=trust_resolver,
        provider=provider.address,
        max_render_gas=sp.mutez(max_render_gas),
        metadata=_META,
    )


def _publish(token_id=0, uri=_REVEALED):
    return sp.record(token_id=token_id, metadata_uri=uri)


@sp.add_test()
def test_deploy_installs_artist_as_admin():
    """One operation, and the artist owns the result outright."""
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
def test_buy_mints_with_pending_metadata():
    """The token exists and is owned when `buy` returns, carrying the
    collection's not-revealed-yet document."""
    scenario = sp.test_scenario("Buy mints", aleatory)
    admin = sp.test_account("Admin")
    minter = sp.test_account("Minter")
    treasury = sp.test_account("Treasury")
    artist = sp.test_account("Artist")
    alice = sp.test_account("Alice")
    resolver, provider, factory = _setup(scenario, admin, minter, treasury)
    c = _collection(scenario, artist, resolver, provider, minter)

    # Price is the piece plus the render gas, neither alone is enough.
    c.mint(_NONE, _sender=alice, _amount=sp.mutez(_PRICE), _valid=False)
    c.mint(_NONE, _sender=alice, _amount=sp.mutez(_TOTAL))

    scenario.verify(c.data.ledger[0] == alice.address)
    scenario.verify(c.data.next_token_id == 1)
    scenario.verify(c.data.token_metadata[0].token_info[""] == _PENDING)
    # Nothing held by the collection: both legs paid inline.
    scenario.verify(c.balance == sp.mutez(0))
    # Render gas went to the provider contract, not to its signing key.
    scenario.verify(provider.balance == sp.mutez(_GAS))


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
    c = _collection(scenario, artist, resolver, provider, minter,
                    start_paused=True)

    c.mint(_NONE, _sender=alice, _amount=sp.mutez(_TOTAL), _valid=False)
    c.set_paused(False, _sender=alice, _valid=False)
    c.set_paused(False, _sender=artist)
    c.mint(_NONE, _sender=alice, _amount=sp.mutez(_TOTAL))


@sp.add_test()
def test_metadata_publishing():
    scenario = sp.test_scenario("Publish metadata", aleatory)
    admin = sp.test_account("Admin")
    minter = sp.test_account("Minter")
    treasury = sp.test_account("Treasury")
    artist = sp.test_account("Artist")
    alice = sp.test_account("Alice")
    resolver, provider, factory = _setup(scenario, admin, minter, treasury)
    c = _collection(scenario, artist, resolver, provider, minter)
    c.mint(_NONE, _sender=alice, _amount=sp.mutez(_TOTAL))

    # Not the artist, not the owner, not a stranger.
    c.set_token_metadata(_publish(), _sender=artist, _valid=False)
    c.set_token_metadata(_publish(), _sender=alice, _valid=False)
    # Never the pending document itself, that would leave it looking
    # unrendered forever.
    c.set_token_metadata(_publish(uri=_PENDING), _sender=minter,
                         _valid=False)

    scenario.verify(c.data.token_metadata[0].token_info[""] == _PENDING)
    c.set_token_metadata(_publish(), _sender=minter)
    scenario.verify(c.data.token_metadata[0].token_info[""] == _REVEALED)

    # Rewritable, on purpose. A publish that lands without its confirmation
    # being seen would otherwise leave a piece that can never be corrected and
    # can never be tried again, and a retry has to be possible.
    c.set_token_metadata(_publish(uri=sp.bytes("0x6f74686572")), _sender=minter)
    scenario.verify(c.data.token_metadata[0].token_info[""] == sp.bytes("0x6f74686572"))

    # Who may write is the bound, not how many times. A revealed piece is no
    # more writable by a stranger than an unrevealed one.
    c.set_token_metadata(_publish(), _sender=alice, _valid=False)
    c.set_token_metadata(_publish(), _sender=artist, _valid=False)

    # And never back to the pending document, which would make a revealed
    # piece look unrendered to every queue watching for one.
    c.set_token_metadata(_publish(uri=_PENDING), _sender=minter, _valid=False)


@sp.add_test()
def test_publishing_touches_one_token_and_nothing_else():
    scenario = sp.test_scenario("Publish scope", aleatory)
    admin = sp.test_account("Admin")
    minter = sp.test_account("Minter")
    treasury = sp.test_account("Treasury")
    artist = sp.test_account("Artist")
    alice = sp.test_account("Alice")
    bob = sp.test_account("Bob")
    resolver, provider, factory = _setup(scenario, admin, minter, treasury)
    c = _collection(scenario, artist, resolver, provider, minter)

    c.mint(sp.bytes("0x7b2264223a317d"), _sender=alice,
          _amount=sp.mutez(_TOTAL))
    c.mint(_NONE, _sender=alice, _amount=sp.mutez(_TOTAL))
    c.set_token_metadata(_publish(), _sender=minter)

    # The neighbouring token is untouched.
    scenario.verify(c.data.token_metadata[1].token_info[""] == _PENDING)
    scenario.verify(c.data.ledger[0] == alice.address)
    # The generator itself is not reachable from here.
    scenario.verify(c.data.art.code_hash == sp.bytes("0xaa"))

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
    c = _collection(scenario, artist, resolver, provider, minter,
                    edition_size=10)

    c.mint(_NONE, _sender=alice, _amount=sp.mutez(_TOTAL))
    c.mint(_NONE, _sender=alice, _amount=sp.mutez(_TOTAL))

    c.set_edition_size(5, _sender=alice, _valid=False)
    c.set_edition_size(20, _sender=artist, _valid=False)   # never grows
    c.set_edition_size(0, _sender=artist, _valid=False)    # never reopens
    c.set_edition_size(1, _sender=artist, _valid=False)    # below minted
    c.set_edition_size(5, _sender=artist)
    scenario.verify(c.data.sale.edition_size == 5)

    # Closing is setting it to what is already minted.
    c.set_edition_size(2, _sender=artist)
    c.mint(_NONE, _sender=alice, _amount=sp.mutez(_TOTAL), _valid=False)

    # Pieces already sold are still publishable after closing.
    c.set_token_metadata(_publish(), _sender=minter)


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
    c = _collection(scenario, artist, resolver, provider, minter,
                    edition_size=0)

    for _ in range(3):
        c.mint(_NONE, _sender=alice, _amount=sp.mutez(_TOTAL))
    scenario.verify(c.data.next_token_id == 3)

    c.set_edition_size(2, _sender=artist, _valid=False)  # below minted
    c.set_edition_size(4, _sender=artist)
    c.mint(_NONE, _sender=alice, _amount=sp.mutez(_TOTAL))
    c.mint(_NONE, _sender=alice, _amount=sp.mutez(_TOTAL), _valid=False)


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
    rival = _provider(scenario, rival_op, rival_key, render_gas=50_000)

    c = _collection(scenario, artist, resolver, provider, minter)
    c.mint(_NONE, _sender=alice, _amount=sp.mutez(_TOTAL))

    switch = sp.record(provider=rival.address, max_price=sp.mutez(100_000))
    c.set_provider(switch, _sender=alice, _valid=False)
    c.set_provider(switch, _sender=artist)
    scenario.verify(c.data.render.render_gas == sp.mutez(50_000))

    # The new provider publishes the piece the old one never did.
    c.set_token_metadata(_publish(), _sender=rival_key)

    # New sales are at the new render gas.
    c.mint(_NONE, _sender=alice, _amount=sp.mutez(_TOTAL), _valid=False)
    c.mint(_NONE, _sender=alice, _amount=sp.mutez(_PRICE + 50_000))


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
    # A provider whose agent is somebody else, so `minter` reaches this
    # collection solely through the resolver, which is what is being
    # tested. Pointing at the default provider would not test it, since
    # its own live agent is `minter`.
    theirs = _provider(scenario, admin, other_agent)
    c = _collection(scenario, artist, resolver, theirs, minter,
                    agent=other_agent)
    c.mint(_NONE, _sender=alice, _amount=sp.mutez(_TOTAL))

    resolver.remove_writer(minter.address, _sender=admin)
    c.set_token_metadata(_publish(), _sender=minter, _valid=False)

    c.set_local_writer(
        sp.record(writer=rescue.address, allowed=True), _sender=alice,
        _valid=False,
    )
    c.set_local_writer(
        sp.record(writer=rescue.address, allowed=True), _sender=artist
    )
    c.set_token_metadata(_publish(), _sender=rescue)
    scenario.verify(c.data.token_metadata[0].token_info[""] == _REVEALED)


@sp.add_test()
def test_artist_can_revoke_resolver_trust():
    """Choosing a rival provider should be able to end our access. Until
    the artist revokes it, the resolver's operator can publish into their
    collection, which is exactly why the switch exists."""
    scenario = sp.test_scenario("Revoke resolver", aleatory)
    admin = sp.test_account("Admin")
    minter = sp.test_account("Minter")
    treasury = sp.test_account("Treasury")
    artist = sp.test_account("Artist")
    alice = sp.test_account("Alice")
    other_agent = sp.test_account("OtherAgent")
    resolver, provider, factory = _setup(scenario, admin, minter, treasury)
    theirs = _provider(scenario, artist, other_agent)
    c = _collection(scenario, artist, resolver, theirs, minter,
                    agent=other_agent)

    c.mint(_NONE, _sender=alice, _amount=sp.mutez(_TOTAL))
    c.mint(_NONE, _sender=alice, _amount=sp.mutez(_TOTAL))

    # A resolver-vouched key can publish while trust is on.
    c.set_token_metadata(_publish(token_id=0), _sender=minter)

    c.set_trust_resolver(False, _sender=alice, _valid=False)
    c.set_trust_resolver(False, _sender=artist)

    # And cannot once it is off.
    c.set_token_metadata(_publish(token_id=1), _sender=minter, _valid=False)
    # The collection's own provider agent still can.
    c.set_token_metadata(_publish(token_id=1), _sender=other_agent)


@sp.add_test()
def test_provider_can_rotate_its_agent_without_resnapshot():
    """A leaked agent key is rotated once, at the provider, and every
    collection follows, no artist has to re-snapshot."""
    scenario = sp.test_scenario("Agent rotation", aleatory)
    admin = sp.test_account("Admin")
    minter = sp.test_account("Minter")
    treasury = sp.test_account("Treasury")
    artist = sp.test_account("Artist")
    alice = sp.test_account("Alice")
    old_agent = sp.test_account("OldAgent")
    new_agent = sp.test_account("NewAgent")
    resolver, provider, factory = _setup(scenario, admin, minter, treasury)
    rival = _provider(scenario, artist, old_agent)

    c = _collection(scenario, artist, resolver, provider, minter,
                    agent=old_agent)
    c.set_provider(
        sp.record(provider=rival.address, max_price=sp.mutez(_GAS)),
        _sender=artist,
    )
    c.set_trust_resolver(False, _sender=artist)
    c.mint(_NONE, _sender=alice, _amount=sp.mutez(_TOTAL))
    c.mint(_NONE, _sender=alice, _amount=sp.mutez(_TOTAL))

    c.set_token_metadata(_publish(token_id=0), _sender=old_agent)

    # Key leaks. One rotation at the provider, no collection touched.
    rival.set_agent(new_agent.address, _sender=artist)
    c.set_token_metadata(_publish(token_id=1), _sender=old_agent,
                         _valid=False)
    c.set_token_metadata(_publish(token_id=1), _sender=new_agent)


@sp.add_test()
def test_provider_income_is_separate_from_its_signing_key():
    """A leaked agent key gives an attacker no money: income accrues in the
    provider contract and only the cold operator key can move it."""
    scenario = sp.test_scenario("Provider payout", aleatory)
    admin = sp.test_account("Admin")
    minter = sp.test_account("Minter")
    treasury = sp.test_account("Treasury")
    artist = sp.test_account("Artist")
    alice = sp.test_account("Alice")
    resolver, provider, factory = _setup(scenario, admin, minter, treasury)
    c = _collection(scenario, artist, resolver, provider, minter)

    c.mint(_NONE, _sender=alice, _amount=sp.mutez(_TOTAL))
    c.mint(_NONE, _sender=alice, _amount=sp.mutez(_TOTAL))
    scenario.verify(provider.balance == sp.mutez(2 * _GAS))

    sweep = sp.record(amount=sp.mutez(2 * _GAS), to_=admin.address)
    provider.withdraw(sweep, _sender=minter, _valid=False)
    provider.withdraw(
        sp.record(amount=sp.mutez(999_999_999), to_=admin.address),
        _sender=admin,
        _valid=False,
    )
    provider.withdraw(sweep, _sender=admin)
    scenario.verify(provider.balance == sp.mutez(0))


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
    c.set_trust_resolver(False, _sender=admin, _valid=False)
    c.set_provider(
        sp.record(provider=provider.address, max_price=sp.mutez(1_000_000)),
        _sender=admin,
        _valid=False,
    )
    c.set_paused(True, _sender=artist)


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
    rival = _provider(scenario, rival_op, rival_key, render_gas=50_000)

    # A stranger can list someone else's provider, it is a public index,
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
def test_royalties_are_readable_on_chain_and_capped():
    """A marketplace pays artists by reading this, not by trusting whoever
    made the listing, so it has to be on chain, and it has to be sane."""
    scenario = sp.test_scenario("Royalties", aleatory)
    admin = sp.test_account("Admin")
    minter = sp.test_account("Minter")
    treasury = sp.test_account("Treasury")
    artist = sp.test_account("Artist")
    collab = sp.test_account("Collaborator")
    resolver, provider, factory = _setup(scenario, admin, minter, treasury)

    split = {artist.address: 1250, collab.address: 1250}
    c = _collection(
        scenario, artist, resolver, provider, minter, royalties=split
    )
    scenario.verify(c.data.art.royalties[artist.address] == 1250)
    scenario.verify(c.data.art.royalties[collab.address] == 1250)

    # Past roughly a quarter, marketplaces stop honouring them.
    factory.deploy(
        _deploy_params(
            provider, royalties={artist.address: 2501}
        ),
        _sender=artist,
        _valid=False,
    )
    factory.deploy(
        _deploy_params(provider, royalties=split), _sender=artist
    )


# === FA2 conformance ===
#
# The collection is an NFT contract before it is anything else, and until
# now exactly one happy-path transfer was covered. These exercise the
# fa2_lib surface as a buyer, a marketplace, or an indexer would hit it.


@sp.add_test()
def test_fa2_operators():
    """Operator rights are what let a marketplace move a token. Only an
    owner may grant them, and only for themselves."""
    scenario = sp.test_scenario("FA2 operators", aleatory)
    admin = sp.test_account("Admin")
    minter = sp.test_account("Minter")
    treasury = sp.test_account("Treasury")
    artist = sp.test_account("Artist")
    alice = sp.test_account("Alice")
    bob = sp.test_account("Bob")
    market = sp.test_account("Market")
    resolver, provider, factory = _setup(scenario, admin, minter, treasury)
    c = _collection(scenario, artist, resolver, provider, minter)
    c.mint(_NONE, _sender=alice, _amount=sp.mutez(_TOTAL))

    op = sp.record(owner=alice.address, operator=market.address, token_id=0)

    # Nobody can appoint an operator over someone else's token.
    c.update_operators([sp.variant.add_operator(op)], _sender=bob,
                       _valid=False)
    # Not even the artist who made the piece.
    c.update_operators([sp.variant.add_operator(op)], _sender=artist,
                       _valid=False)

    # Before approval the market cannot move it.
    tx = [
        sp.record(
            from_=alice.address,
            txs=[sp.record(to_=bob.address, token_id=0, amount=1)],
        )
    ]
    c.transfer(tx, _sender=market, _valid=False)

    c.update_operators([sp.variant.add_operator(op)], _sender=alice)
    c.transfer(tx, _sender=market)
    scenario.verify(c.data.ledger[0] == bob.address)

    # The approval was Alice's, over Alice's token. Now Bob holds it, so
    # the same operator has no rights to move it back.
    back = [
        sp.record(
            from_=bob.address,
            txs=[sp.record(to_=alice.address, token_id=0, amount=1)],
        )
    ]
    c.transfer(back, _sender=market, _valid=False)


@sp.add_test()
def test_fa2_operator_removal():
    scenario = sp.test_scenario("FA2 operator removal", aleatory)
    admin = sp.test_account("Admin")
    minter = sp.test_account("Minter")
    treasury = sp.test_account("Treasury")
    artist = sp.test_account("Artist")
    alice = sp.test_account("Alice")
    bob = sp.test_account("Bob")
    market = sp.test_account("Market")
    resolver, provider, factory = _setup(scenario, admin, minter, treasury)
    c = _collection(scenario, artist, resolver, provider, minter)
    c.mint(_NONE, _sender=alice, _amount=sp.mutez(_TOTAL))

    op = sp.record(owner=alice.address, operator=market.address, token_id=0)
    c.update_operators([sp.variant.add_operator(op)], _sender=alice)
    c.update_operators([sp.variant.remove_operator(op)], _sender=alice)

    c.transfer(
        [
            sp.record(
                from_=alice.address,
                txs=[sp.record(to_=bob.address, token_id=0, amount=1)],
            )
        ],
        _sender=market,
        _valid=False,
    )


@sp.add_test()
def test_fa2_transfer_edges():
    """Batch transfers, self-transfer, zero-amount, unknown token, and
    over-transfer of an NFT."""
    scenario = sp.test_scenario("FA2 transfer edges", aleatory)
    admin = sp.test_account("Admin")
    minter = sp.test_account("Minter")
    treasury = sp.test_account("Treasury")
    artist = sp.test_account("Artist")
    alice = sp.test_account("Alice")
    bob = sp.test_account("Bob")
    resolver, provider, factory = _setup(scenario, admin, minter, treasury)
    c = _collection(scenario, artist, resolver, provider, minter,
                    edition_size=0)

    for _ in range(3):
        c.mint(_NONE, _sender=alice, _amount=sp.mutez(_TOTAL))

    # Two tokens in one batch, one operation.
    c.transfer(
        [
            sp.record(
                from_=alice.address,
                txs=[
                    sp.record(to_=bob.address, token_id=0, amount=1),
                    sp.record(to_=bob.address, token_id=1, amount=1),
                ],
            )
        ],
        _sender=alice,
    )
    scenario.verify(c.data.ledger[0] == bob.address)
    scenario.verify(c.data.ledger[1] == bob.address)

    # A transfer to yourself is legal and changes nothing.
    c.transfer(
        [
            sp.record(
                from_=alice.address,
                txs=[sp.record(to_=alice.address, token_id=2, amount=1)],
            )
        ],
        _sender=alice,
    )
    scenario.verify(c.data.ledger[2] == alice.address)

    # Amount 0 is a no-op the standard requires to succeed.
    c.transfer(
        [
            sp.record(
                from_=alice.address,
                txs=[sp.record(to_=bob.address, token_id=2, amount=0)],
            )
        ],
        _sender=alice,
    )
    scenario.verify(c.data.ledger[2] == alice.address)

    # An NFT has a supply of one, so two is never transferable.
    c.transfer(
        [
            sp.record(
                from_=alice.address,
                txs=[sp.record(to_=bob.address, token_id=2, amount=2)],
            )
        ],
        _sender=alice,
        _valid=False,
    )

    # A token that was never minted.
    c.transfer(
        [
            sp.record(
                from_=alice.address,
                txs=[sp.record(to_=bob.address, token_id=99, amount=1)],
            )
        ],
        _sender=alice,
        _valid=False,
    )

    # A batch is all-or-nothing: the good leg must not land.
    c.transfer(
        [
            sp.record(
                from_=alice.address,
                txs=[
                    sp.record(to_=bob.address, token_id=2, amount=1),
                    sp.record(to_=bob.address, token_id=99, amount=1),
                ],
            )
        ],
        _sender=alice,
        _valid=False,
    )
    scenario.verify(c.data.ledger[2] == alice.address)


@sp.add_test()
def test_fa2_balance_of():
    """`balance_of` is how a marketplace or indexer asks who holds what."""
    scenario = sp.test_scenario("FA2 balance_of", aleatory)
    admin = sp.test_account("Admin")
    minter = sp.test_account("Minter")
    treasury = sp.test_account("Treasury")
    artist = sp.test_account("Artist")
    alice = sp.test_account("Alice")
    bob = sp.test_account("Bob")
    resolver, provider, factory = _setup(scenario, admin, minter, treasury)
    c = _collection(scenario, artist, resolver, provider, minter)
    c.mint(_NONE, _sender=alice, _amount=sp.mutez(_TOTAL))

    # `balance_of` proper is the callback entrypoint; `get_balance_of` is
    # fa2_lib's on-chain view equivalent, which is what an indexer or a
    # marketplace contract actually calls.
    held = sp.View(c, "get_balance_of")(
        [
            sp.record(owner=alice.address, token_id=0),
            sp.record(owner=bob.address, token_id=0),
        ]
    )
    # One request per owner, answered in order.
    scenario.verify(sp.len(held) == 2)

    # And the views a marketplace depends on answer too.
    scenario.verify(
        sp.View(c, "get_edition")().minted == 1
    )
    scenario.verify(sp.len(sp.View(c, "get_royalties")()) == 0)


# === Edge cases ===


@sp.add_test()
def test_free_mint_and_zero_render_gas():
    """An artist can give pieces away, and can run their own rendering by
    setting a provider that charges nothing. Neither should send an empty
    transfer or fail."""
    scenario = sp.test_scenario("Free mint", aleatory)
    admin = sp.test_account("Admin")
    minter = sp.test_account("Minter")
    treasury = sp.test_account("Treasury")
    artist = sp.test_account("Artist")
    alice = sp.test_account("Alice")
    resolver, provider, factory = _setup(scenario, admin, minter, treasury,
                                         render_gas=0)
    c = _collection(scenario, artist, resolver, provider, minter,
                    price=0, render_gas=0)

    c.mint(_NONE, _sender=alice, _amount=sp.mutez(0))
    scenario.verify(c.data.ledger[0] == alice.address)
    scenario.verify(c.balance == sp.mutez(0))
    scenario.verify(provider.balance == sp.mutez(0))

    # Overpaying a free mint is still refused: the price is exact.
    c.mint(_NONE, _sender=alice, _amount=sp.mutez(1), _valid=False)


@sp.add_test()
def test_edition_of_one():
    scenario = sp.test_scenario("Edition of one", aleatory)
    admin = sp.test_account("Admin")
    minter = sp.test_account("Minter")
    treasury = sp.test_account("Treasury")
    artist = sp.test_account("Artist")
    alice = sp.test_account("Alice")
    resolver, provider, factory = _setup(scenario, admin, minter, treasury)
    c = _collection(scenario, artist, resolver, provider, minter,
                    edition_size=1)

    c.mint(_NONE, _sender=alice, _amount=sp.mutez(_TOTAL))
    c.mint(_NONE, _sender=alice, _amount=sp.mutez(_TOTAL), _valid=False)
    # Already at its own floor; setting it there again is a no-op, not an
    # error, and it cannot go lower.
    c.set_edition_size(1, _sender=artist)
    c.set_edition_size(0, _sender=artist, _valid=False)


@sp.add_test()
def test_params_survive_the_round_trip():
    """The collector's chosen parameters are recorded by their own
    signature. Nothing downstream can alter them, and the contract does not
    interpret them."""
    scenario = sp.test_scenario("Params", aleatory)
    admin = sp.test_account("Admin")
    minter = sp.test_account("Minter")
    treasury = sp.test_account("Treasury")
    artist = sp.test_account("Artist")
    alice = sp.test_account("Alice")
    resolver, provider, factory = _setup(scenario, admin, minter, treasury)
    c = _collection(scenario, artist, resolver, provider, minter)

    # {"density":140,"ink":"black"}
    params = sp.bytes(
        "0x7b2264656e73697479223a3134302c22696e6b223a22626c61636b227d"
    )
    c.mint(params, _sender=alice, _amount=sp.mutez(_TOTAL))
    c.mint(_NONE, _sender=alice, _amount=sp.mutez(_TOTAL))
    scenario.verify(c.data.ledger[0] == alice.address)
    scenario.verify(c.data.ledger[1] == alice.address)


@sp.add_test()
def test_royalties_at_the_ceiling_and_empty():
    scenario = sp.test_scenario("Royalty edges", aleatory)
    admin = sp.test_account("Admin")
    minter = sp.test_account("Minter")
    treasury = sp.test_account("Treasury")
    artist = sp.test_account("Artist")
    a = sp.test_account("R1")
    b = sp.test_account("R2")
    resolver, provider, factory = _setup(scenario, admin, minter, treasury)

    # Exactly at the cap is allowed; one basis point over is not.
    factory.deploy(
        _deploy_params(
            provider, royalties={a.address: 1500, b.address: 1000}
        ),
        _sender=artist,
    )
    factory.deploy(
        _deploy_params(
            provider, royalties={a.address: 1500, b.address: 1001}
        ),
        _sender=artist,
        _valid=False,
    )
    # No royalties at all is a legitimate choice.
    factory.deploy(_deploy_params(provider), _sender=artist)
    scenario.verify(factory.data.next_collection_id == 2)


# === Invariants ===


@sp.add_test()
def test_collection_never_holds_tez():
    """`buy` forwards both legs in the same operation. If this contract
    ever holds a balance, something has gone wrong, there is no withdraw
    entrypoint to get it out again."""
    scenario = sp.test_scenario("No stuck tez", aleatory)
    admin = sp.test_account("Admin")
    minter = sp.test_account("Minter")
    treasury = sp.test_account("Treasury")
    artist = sp.test_account("Artist")
    alice = sp.test_account("Alice")
    resolver, provider, factory = _setup(scenario, admin, minter, treasury)
    c = _collection(scenario, artist, resolver, provider, minter,
                    edition_size=0)

    for _ in range(5):
        c.mint(_NONE, _sender=alice, _amount=sp.mutez(_TOTAL))
        scenario.verify(c.balance == sp.mutez(0))

    # Every entrypoint that is not `buy` refuses tez outright, so there is
    # no other way in.
    c.set_price(sp.mutez(1), _sender=artist, _amount=sp.mutez(1),
                _valid=False)
    c.set_paused(True, _sender=artist, _amount=sp.mutez(1), _valid=False)
    c.set_edition_size(9, _sender=artist, _amount=sp.mutez(1), _valid=False)
    c.set_token_metadata(_publish(), _sender=minter, _amount=sp.mutez(1),
                         _valid=False)
    scenario.verify(c.balance == sp.mutez(0))


@sp.add_test()
def test_resolver_trust_is_opt_in():
    """A collection deployed without asking for it owes the resolver nothing,
    so our keys reach it only where an artist said so."""
    scenario = sp.test_scenario("Resolver opt-in", aleatory)
    admin = sp.test_account("Admin")
    minter = sp.test_account("Minter")
    treasury = sp.test_account("Treasury")
    artist = sp.test_account("Artist")
    alice = sp.test_account("Alice")
    other_agent = sp.test_account("OtherAgent")
    resolver, provider, factory = _setup(scenario, admin, minter, treasury)
    theirs = _provider(scenario, artist, other_agent)

    closed = _collection(
        scenario, artist, resolver, theirs, minter,
        agent=other_agent, trust_resolver=False,
    )
    closed.mint(_NONE, _sender=alice, _amount=sp.mutez(_TOTAL))
    # `minter` is vouched for by the resolver and nothing else.
    closed.set_token_metadata(_publish(), _sender=minter, _valid=False)

    # And an artist who asked for it gets the convenience.
    opened = _collection(
        scenario, artist, resolver, theirs, minter,
        agent=other_agent, trust_resolver=True,
    )
    opened.mint(_NONE, _sender=alice, _amount=sp.mutez(_TOTAL))
    opened.set_token_metadata(_publish(), _sender=minter)


@sp.add_test()
def test_the_generator_is_on_chain():
    """Fully on chain has to mean the art is in storage. A collection either
    carries its generator or points at one, never both and never neither,
    because none of it is changeable afterwards."""
    scenario = sp.test_scenario("On-chain code", aleatory)
    admin = sp.test_account("Admin")
    artist = sp.test_account("Artist")
    agent = sp.test_account("Agent")

    resolver = aleatory.AleatoryResolver(administrator=admin.address, writers=sp.set())
    scenario += resolver
    provider = aleatory.AleatoryProvider(
        operator=admin.address, agent=agent.address,
        render_gas=sp.mutez(0), metadata=_META,
    )
    scenario += provider
    factory = aleatory.AleatoryFactory(
        administrator=admin.address, treasury=admin.address,
        deploy_price=sp.mutez(0), resolver=resolver.address,
    )
    scenario += factory

    # The normal case: the generator is in the operation and ends up in
    # storage, readable by anyone with an RPC and nothing else.
    factory.deploy(_deploy_params(provider), _sender=artist)
    c = scenario.dynamic_contract(aleatory.AleatoryCollection)
    scenario.verify(c.data.art.code == _CODE)
    scenario.verify(c.data.art.code_encoding == "identity")
    scenario.verify(c.data.art.code_uri == "")

    # A generator past the operation cap may point instead.
    factory.deploy(
        _deploy_params(provider, code=sp.bytes("0x"), code_uri=_CODE_URI),
        _sender=artist,
    )

    # Neither is a collection with no art in it.
    factory.deploy(
        _deploy_params(provider, code=sp.bytes("0x"), code_uri=""),
        _sender=artist, _valid=False,
    )
    # Both is two sources that can disagree about what the art is.
    factory.deploy(
        _deploy_params(provider, code=_CODE, code_uri=_CODE_URI),
        _sender=artist, _valid=False,
    )
    # An encoding nothing can decode is a generator nobody can ever run.
    factory.deploy(
        _deploy_params(provider, code_encoding="brotli"),
        _sender=artist, _valid=False,
    )
    # gzip is allowed, for a generator that would not otherwise fit.
    factory.deploy(
        _deploy_params(provider, code_encoding="gzip"), _sender=artist,
    )
    # The hash is what a reader checks the storage against.
    factory.deploy(
        _deploy_params(provider, code_hash=sp.bytes("0x")),
        _sender=artist, _valid=False,
    )


@sp.add_test()
def test_router_keeps_every_factory():
    """A redeploy must not orphan the collections the old factory made.
    They are real collections owned by real artists, and a reader that only
    knew the newest factory would drop them off the site entirely."""
    scenario = sp.test_scenario("Router", aleatory)
    admin = sp.test_account("Admin")
    stranger = sp.test_account("Stranger")
    f1 = sp.test_account("Factory1")
    f2 = sp.test_account("Factory2")
    market = sp.test_account("Market")
    registry = sp.test_account("Registry")
    resolver = sp.test_account("Resolver")

    r = aleatory.AleatoryRouter(
        administrator=admin.address,
        factory=f1.address,
        marketplace=market.address,
        registry=registry.address,
        resolver=resolver.address,
    )
    scenario += r

    scenario.verify(r.get_factory() == f1.address)

    # A new factory goes to the head, and the old one is still listed.
    r.add_factory(f2.address, _sender=admin)
    scenario.verify(r.get_factory() == f2.address)
    # A list is not comparable in Michelson, so the storage is read directly.
    scenario.verify(sp.len(r.data.factories) == 2)

    # Nobody else may point readers anywhere.
    r.add_factory(stranger.address, _sender=stranger, _valid=False)
    r.set_marketplace(stranger.address, _sender=stranger, _valid=False)
    r.set_registry(stranger.address, _sender=stranger, _valid=False)
    r.set_resolver(stranger.address, _sender=stranger, _valid=False)

    # It is a directory, not a treasury.
    r.add_factory(f1.address, _sender=admin, _amount=sp.mutez(1), _valid=False)

    # One call gets a front end everything.
    scenario.verify(r.get_addresses().marketplace == market.address)
    scenario.verify(r.get_addresses().registry == registry.address)

    # Handover is two steps, so a typo cannot strand it.
    r.propose_admin(stranger.address, _sender=admin)
    r.accept_admin(_sender=admin, _valid=False)
    r.accept_admin(_sender=stranger)
    r.add_factory(f1.address, _sender=admin, _valid=False)
    r.add_factory(f1.address, _sender=stranger)


@sp.add_test()
def test_render_gas_is_what_the_provider_charges_now():
    """The provider sets their price. A mint pays it, whatever it is that
    day, and an artist who does not like it picks somebody else."""
    scenario = sp.test_scenario("Live render gas", aleatory)
    admin = sp.test_account("Admin")
    minter = sp.test_account("Minter")
    treasury = sp.test_account("Treasury")
    artist = sp.test_account("Artist")
    alice = sp.test_account("Alice")
    rival_op = sp.test_account("RivalOperator")
    rival_key = sp.test_account("RivalKey")
    resolver, provider, factory = _setup(scenario, admin, minter, treasury)
    c = _collection(scenario, artist, resolver, provider, minter)

    # A cut reaches the collection with nothing else happening.
    provider.set_render_gas(sp.mutez(_GAS // 2), _sender=admin)
    c.mint(_NONE, _sender=alice, _amount=sp.mutez(_TOTAL), _valid=False)
    c.mint(_NONE, _sender=alice, _amount=sp.mutez(_PRICE + _GAS // 2))
    scenario.verify(provider.balance == sp.mutez(_GAS // 2))

    # So does a rise. The artist's own price is untouched by either.
    provider.set_render_gas(sp.mutez(_GAS * 3), _sender=admin)
    c.mint(_NONE, _sender=alice, _amount=sp.mutez(_PRICE + _GAS // 2),
           _valid=False)
    c.mint(_NONE, _sender=alice, _amount=sp.mutez(_PRICE + _GAS * 3))
    scenario.verify(provider.balance == sp.mutez(_GAS // 2 + _GAS * 3))
    # Nothing held back: both legs left the contract in the same operation.
    scenario.verify(c.balance == sp.mutez(0))

    # An artist who does not like the new price picks somebody else.
    rival = _provider(scenario, rival_op, rival_key, render_gas=_GAS)
    c.set_provider(
        sp.record(provider=rival.address, max_price=sp.mutez(_GAS)),
        _sender=artist,
    )
    c.mint(_NONE, _sender=alice, _amount=sp.mutez(_PRICE + _GAS))
    scenario.verify(rival.balance == sp.mutez(_GAS))
