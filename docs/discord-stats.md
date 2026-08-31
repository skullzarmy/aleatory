# Stat channels

Aleatory's numbers, shown as Discord channel names in the sidebar.

```
📊 Server Stats
 🔒 🎨 Generators: 12
 🔒 🖼 Pieces: 26
 🔒 💸 Minted: 913.27 ꜩ
 🔒 🏦 Earned: 9.7 ꜩ
```

Every figure is read from the chain through the router, so pointing this at
mainnet is two environment variables and no code.

## How it runs

A Netlify scheduled function, `netlify/functions/discord-stats.mts`, every ten
minutes. Renaming a channel is a single REST call, so there is no gateway
connection, no bot process, and nothing to keep alive.

**Ten minutes is the floor, not a preference.** Discord limits a channel rename
to about two per ten minutes, per channel. A name that has not changed is never
written, so a quiet period spends none of that budget.

---

## Setting it up

### 1. Create the bot

1. Go to <https://discord.com/developers/applications> and **New Application**.
   Name it whatever the channels should credit.
2. **Bot** in the sidebar, then **Reset Token**, then copy the token. It is
   shown once. This is `DISCORD_BOT_TOKEN`.
3. Turn **Public Bot** off. Nobody else needs to add it anywhere.
4. No privileged intents. It never reads a message.

### 2. Invite it

**OAuth2 → URL Generator**:

- Scopes: `bot`
- Bot permissions: **Manage Channels** only

Open the generated URL and add it to your server.

Manage Channels is the whole permission set. It cannot read messages, and with
the channel permissions in step 3 it cannot speak either.

### 3. Make the channels

In your server, create a category (`📊 Server Stats`) and inside it one **voice
channel** per figure. Voice channels are the convention because the name shows
at full width and nobody joins them by accident.

Name them anything for now. The bot overwrites the names.

For each channel, or once on the category with the channels syncing from it:

| Role | Permission | Set to |
| --- | --- | --- |
| `@everyone` | Connect | ❌ deny |
| `@everyone` | View Channel | ✅ allow |
| your bot | Manage Channel | ✅ allow |

Denying Connect is what puts the padlock on and stops anyone joining. Allowing
View Channel is what keeps it visible in the sidebar.

### 4. Get the channel IDs

**User Settings → Advanced → Developer Mode**, on. Then right-click each
channel and **Copy Channel ID**.

### 5. Set the environment

In Netlify, **Site configuration → Environment variables**:

| Variable | Value |
| --- | --- |
| `DISCORD_BOT_TOKEN` | the token from step 1 |
| `DISCORD_STAT_CHANNELS` | the JSON below, with your IDs |
| `ALEA_PROVIDER_ADDRESS` | your render provider's `KT1` |
| `NEXT_PUBLIC_ROUTER_ADDRESS` | already set, the router |
| `NEXT_PUBLIC_TEZOS_NETWORK` | already set, `shadownet` or `mainnet` |

```json
[
  { "id": "1410000000000000001", "label": "🎨 Generators: {generators}" },
  { "id": "1410000000000000002", "label": "🖼 Pieces: {pieces}" },
  { "id": "1410000000000000003", "label": "💸 Minted: {minted} ꜩ" },
  { "id": "1410000000000000004", "label": "🏦 Earned: {earned} ꜩ" }
]
```

The wording is yours. Change a label and the next run rewrites that channel, no
deploy needed.

### 6. Check it

Deploy, then hit the function once by hand:

```
curl https://<your-site>.netlify.app/.netlify/functions/discord-stats
```

It answers with the figures it read and what it did to each channel:

```json
{
  "stats": { "generators": 12, "pieces": 26, "mintedMutez": 913270000, ... },
  "results": [
    "1410000000000000001: \"stats-1\" → \"🎨 Generators: 12\"",
    "1410000000000000002: unchanged"
  ]
}
```

---

## Placeholders

| | |
| --- | --- |
| `{generators}` | Collections originated by any factory the router has named |
| `{pieces}` | Tokens minted across all of them |
| `{minted}` | What collectors have paid to mint, price and render gas together |
| `{earned}` | The three below, added up |
| `{treasury}` | Reached the treasury: swept fees, and our royalty shares |
| `{unswept}` | Fees the contracts still hold for the treasury |
| `{renderGas}` | Our render provider's lifetime intake |

Counts get thousands separators. Tez is abbreviated past a thousand (`2.5K`,
`4.2M`) so it fits. An unknown placeholder is left in the name as written, so a
typo is visible instead of silently blank.

## What the money figures mean

Counted where it landed, never from a contract's own bookkeeping.

Three marketplace generations are live and they do not agree about royalties:
the first accrued them for later claiming, the ones after it pay every
recipient inside the sale. Adding up their storage would mean asking each
contract a different question and knowing which is which. What arrived at the
treasury is one question with one answer, and it survives the next redeploy.

`{unswept}` is counted as earned because a sweep is permissionless: the
destination is fixed in each contract's storage, so that money is already the
treasury's in every sense except custody.

## When a read fails

The run stops and renames nothing, answering `503` with what failed. A partial
read leaves a figure at zero, and writing a zero over a real number is worse
than leaving the last good one on screen.

## Switching to mainnet

`NEXT_PUBLIC_TEZOS_NETWORK=mainnet`, `NEXT_PUBLIC_ROUTER_ADDRESS` to the
mainnet router, `ALEA_PROVIDER_ADDRESS` to the mainnet provider. Everything
else resolves from the router: factories newest first, every marketplace it has
ever pointed at, the registry and the resolver.
