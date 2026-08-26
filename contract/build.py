"""Compile every contract to a predictable path for the deploy scripts.

    python3 contract/build.py

Writes `contract/build/<Name>/step_001_cont_0_contract.json` for each, so a
deploy script has one stable path to read.

Originates nothing and asserts nothing. What gets deployed is compiled by one
command, from source, on purpose.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

os.environ.setdefault(
    "SMARTPY_OUTPUT_DIR",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "build"),
)

import smartpy as sp

from aleatory import aleatory
from marketplace import marketplace


_ZERO = sp.address("tz1burnburnburnburnburnburnburjAYjjX")
_META = sp.big_map({"": sp.bytes("0x00")})


@sp.add_test()
def AleatoryResolver():
    sc = sp.test_scenario("AleatoryResolver", aleatory)
    sc += aleatory.AleatoryResolver(administrator=_ZERO, writers=sp.set())


@sp.add_test()
def AleatoryProvider():
    sc = sp.test_scenario("AleatoryProvider", aleatory)
    sc += aleatory.AleatoryProvider(
        operator=_ZERO, agent=_ZERO, render_gas=sp.mutez(0), metadata=_META
    )


@sp.add_test()
def AleatoryRouter():
    sc = sp.test_scenario("AleatoryRouter", aleatory)
    sc += aleatory.AleatoryRouter(
        administrator=sp.address("tz1Ke2h7sDdakHJQh8WX4Z372du1KChsksyU"),
        factory=sp.address("KT1Tezooo1zzSmartPyzzSTATiCzzzwwBFA1"),
        marketplace=sp.address("KT1Tezooo1zzSmartPyzzSTATiCzzzwwBFA1"),
        registry=sp.address("KT1Tezooo1zzSmartPyzzSTATiCzzzwwBFA1"),
        resolver=sp.address("KT1Tezooo1zzSmartPyzzSTATiCzzzwwBFA1"),
    )


def AleatoryRegistry():
    sc = sp.test_scenario("AleatoryRegistry", aleatory)
    sc += aleatory.AleatoryRegistry()


@sp.add_test()
def AleatoryFactory():
    sc = sp.test_scenario("AleatoryFactory", aleatory)
    sc += aleatory.AleatoryFactory(
        administrator=_ZERO,
        treasury=_ZERO,
        deploy_price=sp.mutez(0),
        resolver=_ZERO,
    )


@sp.add_test()
def AleatoryMarketplace():
    sc = sp.test_scenario("AleatoryMarketplace", marketplace)
    sc += marketplace.AleatoryMarketplace(
        administrator=_ZERO, treasury=_ZERO, fee_bps=250, metadata=_META
    )
