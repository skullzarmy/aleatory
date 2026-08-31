# The stats bot

Aleatory's numbers, written into Discord channel names.

```
📊 Server Stats
 🔒 🎨 Generators: 12
 🔒 🖼 Pieces: 26
 🔒 💸 Minted: 913.27 ꜩ
 🔒 🏦 Earned: 9.7 ꜩ
```

A process, run wherever the provider runs. Nothing here imports from the site,
so it keeps working if the site is deleted.

```
npm run bot:check     read the chain, print the names, write nothing
npm run bot:run       one pass, then exit
npm run bot:daemon    the process. This is how it runs.
```

## Why there is no gateway connection

A Discord bot needs a persistent WebSocket only to *receive* events: messages,
joins, presence. This receives nothing. Renaming a channel is one request:

```
PATCH /channels/{id}    {"name": "🎨 Generators: 12"}
```

So this is an outbound HTTP client on a timer.

**The timer is ten minutes because Discord allows about two renames per ten
minutes, per channel.** Polling faster spends that allowance on names that have
not changed. A name that matches what is already there is never written, so a
quiet week leaves the whole allowance for the hour something happens.

## Setting it up

### 1. The application

<https://discord.com/developers/applications> → **New Application**.

**Bot** → **Reset Token** → copy it. Shown once. This is `DISCORD_BOT_TOKEN`.

Turn **Public Bot** off. No privileged intents: it never reads a message.

### 2. Invite it

**OAuth2 → URL Generator**, scope `bot`, bot permission **Manage Channels**.
That is the whole permission set. Open the URL and add it to the server.

### 3. The channels

Make a category, and inside it one **voice channel** per figure. Voice channels
show the name at full width and nobody joins one by accident.

Name them anything. They get overwritten.

On each channel, or once on the category with the channels syncing:

| Role | Permission | |
| --- | --- | --- |
| `@everyone` | View Channel | allow, so it stays in the sidebar |
| `@everyone` | Connect | deny, which is what puts the padlock on |
| the bot | Manage Channel | allow |

### 4. The IDs

**User Settings → Advanced → Developer Mode** on. Right-click each channel,
**Copy Channel ID**.

### 5. The environment

In `.env`, beside the provider's:

```
ALEA_NETWORK=shadownet
ALEA_ROUTER_ADDRESS=KT1LWD8kiuyVzkSUAHKVovw6ymsjHcKykADc
ALEA_PROVIDER_ADDRESS=KT1G8ivJQiXNTHBbCSwhTgjSjt5Jp3c8bv6m
DISCORD_BOT_TOKEN=...
DISCORD_STAT_CHANNELS=[{"id":"...","label":"🎨 Generators: {generators}"},{"id":"...","label":"🖼 Pieces: {pieces}"},{"id":"...","label":"💸 Minted: {minted} ꜩ"},{"id":"...","label":"🏦 Earned: {earned} ꜩ"}]
```

The router is the only contract address configured. Factories, marketplaces,
the registry and the resolver are all read from it.

### 6. Check it, then run it

```
npm run bot:check
```

```
shadownet, router KT1LWD8kiuyVzkSUAHKVovw6ymsjHcKykADc

  generators    12
  pieces        26
  minted        913.270000 tez
  earned        9.700000 tez
    treasury    8.750000 tez
    unswept     0.250000 tez
    render gas  0.700000 tez

  1410000000000000001  "🎨 Generators: 12"
  1410000000000000002  "🖼 Pieces: 26"

  dry run, nothing written
```

Then `npm run bot:daemon`, under whatever keeps the provider up.

## Placeholders

| | |
| --- | --- |
| `{generators}` | Collections originated by any factory the router has named |
| `{pieces}` | Tokens minted across all of them |
| `{minted}` | What collectors paid to mint, price and render gas together |
| `{earned}` | The three below, added up |
| `{treasury}` | Reached the treasury: swept fees, and platform royalty shares |
| `{unswept}` | Fees the contracts still hold for the treasury |
| `{renderGas}` | The render provider's lifetime intake |

Counts get thousands separators, tez is abbreviated past a thousand (`2.5K`,
`4.2M`). An unknown placeholder is left in the name as written, so a typo is
visible instead of silently blank.

## What the money figures mean

Counted where it landed, never from a contract's own bookkeeping.

Three marketplace generations are live and they do not agree about royalties:
the first accrued them for later claiming, the ones after it pay every
recipient inside the sale. Adding up their storage would mean asking each
contract a different question and knowing which is which. What arrived at the
treasury is one question with one answer, and it survives the next redeploy.

`{unswept}` counts as earned because a sweep is permissionless: the destination
is fixed in each contract's storage, so that money is the treasury's in every
sense except custody.

A figure that fails to read comes back zero, so a pass with any failure writes
nothing and logs why. Leaving the last good names up beats replacing them with
zeros.

## Mainnet

`ALEA_NETWORK=mainnet`, `ALEA_ROUTER_ADDRESS` and `ALEA_PROVIDER_ADDRESS` to
the mainnet contracts. Nothing else changes.
