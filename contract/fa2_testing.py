"""A complete TZIP-12 FA2 for testing the marketplace against a real token.

The stubs in `tests_marketplace.py` isolate marketplace logic by skipping the
FA2 operator layer entirely: their `transfer` checks ownership and nothing
else. That is right for unit tests and wrong for one question the stubs
cannot ask: does the marketplace's escrow dance, grant operator, list,
revoke, actually satisfy a standards-compliant token?

This module answers it with the official SmartPy FA2 library, NFT base,
owner-or-operator transfer policy, plus the one thing the marketplace reads
from a collection: a `get_royalties` view, set at origination, immutable
after, exactly like the real collection contract.

Not deployed as part of the platform. It exists for tests_marketplace.py and
for originating a compliant third-party-style collection on a testnet.
"""

import smartpy as sp
from smartpy.templates import fa2_lib as fa2

main = fa2.main


@sp.module
def fa2_testing():
    import main

    class FullFa2(main.Admin, main.Nft, main.MintNft, main.OnchainviewBalanceOf):
        def __init__(self, administrator, metadata, ledger, token_metadata, royalties):
            main.OnchainviewBalanceOf.__init__(self)
            main.MintNft.__init__(self)
            main.Nft.__init__(self, metadata, ledger, token_metadata)
            main.Admin.__init__(self, administrator)
            # What the marketplace reads. Shares in basis points of the sale
            # price, keyed by recipient, like the real collection.
            self.data.royalties = sp.cast(royalties, sp.map[sp.address, sp.nat])

        @sp.onchain_view()
        def get_royalties(self):
            return self.data.royalties
