# The Discord bot

Aleatory's numbers, written into Discord channel names.

```
📊 Server Stats
 🔒 🎨 Generators: 12
 🔒 🖼 Pieces: 26
 🔒 💸 Minted: 913.27 ꜩ
 🔒 🏦 Earned: 9.7 ꜩ
```

It also announces. A generator published on chain gets a message in one
channel, a piece minted gets one in another, each with its picture and a link
to its page.

A process, run wherever the provider runs. Nothing here imports from the site,
so it keeps working if the site is deleted.

```
npm run bot:check     read the chain, print the names, write nothing
npm run bot:doctor    ask Discord why it is refusing
npm run bot:run       one pass, then exit
npm run bot:daemon    the process. This is how it runs.
```

## Why there is no gateway connection

A Discord bot needs a persistent WebSocket only to *receive* events: messages,
joins, presence. This receives nothing. It renames and it speaks, and both are
one request:

```
PATCH /channels/{id}             {"name": "🎨 Generators: 12"}
POST  /channels/{id}/messages    {"embeds": [ … ]}
```

So this is an outbound HTTP client on two timers.

**The slow one is ten minutes because Discord allows about two renames per ten
minutes, per channel.** Polling faster spends that allowance on names that have
not changed. A name that matches what is already there is never written, so a
quiet week leaves the whole allowance for the hour something happens.

**The fast one is a minute, and is only for announcements.** That rename limit
says nothing about posting a message, and a mint announced nine minutes after
the mint is not an announcement. `ALEA_BOT_ANNOUNCE_MS` moves it, with a floor
of fifteen seconds, because the chain reads behind it are not free.

## What it watches

The contracts say what happened, and those events are the interface this reads:

```
tag=deploy              collection_id, address, artist, code, code_encoding,
                        code_hash, code_uri, edition_size
tag=mint                token_id, buyer, params, paid, render_gas
tag=set_token_metadata  token_id, metadata_uri, renderer
```

So the price and the traits in an announcement are what the contract published,
rather than figures reconstructed from an indexer's tables.

## A piece is announced when it is rendered

**The trigger is `set_token_metadata`, not `mint`.** At mint time
`token_info[""]` still holds the collection's pending document, so a message
sent then has no picture in it, and a picture is the point of announcing a
piece of art. `set_token_metadata` refuses the pending document outright, so it
fires only when there is something real to show.

That costs the time between the two, usually under a minute, and buys a message
that is never an empty frame.

Both tags come back on one cursor. A `mint` row is held in memory keyed on
contract and token together, since every collection numbers from zero and token
0 is a different piece in each one. The render releases it.

Two things follow:

**A piece that is never rendered is never announced.** Its mint waits and
nothing fires. That is a stuck provider, and the piece is on the site either
way.

**`set_token_metadata` is rewritable on purpose**, so a provider retrying a
publish emits it again for a piece already posted. Thirteen of thirty-nine
pieces on shadownet have been written more than once, so the bot remembers what
it has announced and stays quiet the second time.

Across a restart, a piece minted before startup and rendered after it arrives
with no `mint` event. The traits come off the piece's own document instead,
which the chain published just the same. **`paid` does not**, so that field is
left off rather than filled in from the collection's current price.

## The reads on top

Neither event carries a display name or a picture, because those are metadata
documents rather than contract state, so an announcement adds one read for the
title and the image. What a collection is called, who made it and how large the
edition is are read once per collection and held for the life of the process:
none of it changes per mint, so a busy collection costs two reads in total.

```
GET /v1/contracts/events?contract.in=…&tag=mint&id.gt=<mark>&sort.asc=id
```

## Forward only

The bot reads where the chain is when it starts and goes on from there. It has
no memory across restarts and no state file, and it wants none: **an event is
emitted once**, so a process that only ever looks forward can never announce
one twice. The mark is an event id, ids only go up, and `id.gt` is the whole of
it.

The consequence is the other side of that. **Anything that happens while the
bot is down is never announced.** It is not a queue and it does not catch up.
If that matters for a particular deploy, the pieces are all on the site and on
the chain, where they were the whole time.

## Setting it up

### 1. The application

<https://discord.com/developers/applications> → **New Application**.

**Bot** → **Reset Token** → copy it. Shown once. This is `DISCORD_BOT_TOKEN`.

Turn **Public Bot** off. No privileged intents: it never reads a message.

### 2. Invite it

**OAuth2 → URL Generator**, scope `bot`, bot permissions **View Channels**,
**Manage Channels**, **Send Messages** and **Embed Links**. That is the whole
set, and it is permission integer `19472`:

```
https://discord.com/oauth2/authorize?client_id=<APPLICATION_ID>&scope=bot&permissions=19472
```

View Channels is not optional: a name is read before it is written, so a bot
that cannot see the channel gets a 404 on the read and never reaches the
rename.

Send Messages and Embed Links are only for the announcement channels, and they
are the pair that catches people out. A token that has been renaming stat
channels for weeks has never once needed either, so the first failure arrives
long after setup looked finished.

### 3. The channels

Make a category, and inside it one **voice channel** per figure. Voice channels
show the name at full width and nobody joins one by accident.

Name them anything. They get overwritten.

Set these on the **category**, and leave the channels synced to it, so a new
figure later is one channel and no permission work.

| Role | Permission | |
| --- | --- | --- |
| `@everyone` | View Channel | allow, so it stays in the sidebar |
| `@everyone` | Connect | deny, which is what puts the padlock on |
| the bot's role | View Channel | allow |
| the bot's role | Manage Channel | allow |

The bot needs its own overwrite here. A server-wide permission is overridden by
a channel that denies it, and the read that comes before every rename fails
with a 404 that looks like a wrong channel ID.

### 4. The announcement channels

Two ordinary **text** channels, wherever you want them. They are separate from
the stat category on purpose: this is the half of the bot that talks, and a
channel that is only ever announcements is a channel somebody can mute.

| Role | Permission | |
| --- | --- | --- |
| the bot's role | View Channel | allow |
| the bot's role | Send Messages | allow |
| the bot's role | Embed Links | allow, or the message arrives empty |

Embed Links is the quiet one. Without it Discord accepts the request and drops
the embed, so the bot logs a success and the channel shows nothing.

### 5. The IDs

**User Settings → Advanced → Developer Mode** on. Right-click each channel,
**Copy Channel ID**.

### 6. The environment

In `.env`, beside the provider's:

```
ALEA_NETWORK=              # shadownet or mainnet. The only place it is named.
ALEA_ROUTER_ADDRESS=KT1…   # the router on that network
ALEA_PROVIDER_ADDRESS=KT1… # the render provider on that network
ALEA_SITE_URL=             # where the links in an announcement point
DISCORD_BOT_TOKEN=
DISCORD_STAT_CHANNELS=[{"id":"…","label":"🎨 Generators: {generators}"},{"id":"…","label":"🖼 Pieces: {pieces}"},{"id":"…","label":"💸 Minted: {minted} ꜩ"},{"id":"…","label":"🏦 Earned: {earned} ꜩ"}]
DISCORD_GENERATORS_CHANNEL=
DISCORD_MINTS_CHANNEL=
```

Optional:

```
ALEA_BOT_TICK_MS=          # the rename clock. Ten minutes, and its own floor.
ALEA_BOT_ANNOUNCE_MS=      # the announcement clock. A minute, floor of fifteen seconds.
```

Leave either announcement channel empty and that half stays quiet. Leave both
empty and the bot is what it was before: stat channels on the slow clock.

`ALEA_SITE_URL` is what an announcement links to and where it loads pictures
from, through the site's own `/api/img` route. It has nothing to do with which
chain is read, which is `ALEA_NETWORK` above, so point it at whichever site is
showing that network.

The router is the only contract address that has to be configured. Factories,
marketplaces, the registry and the resolver are all read from it, so the three
values above are the whole difference between one network and another.

### 7. Check it, then run it

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

Then `npm run bot:daemon` in the foreground once, to watch a pass go by.

---

## Keeping it running

### Linux, systemd

Same shape as the provider in [deploying.md](../docs/deploying.md), and it can
live in the same checkout beside it, reading the same `.env`.

**Get the three real values first.** systemd resolves none of them, and each is
a common way to fail:

```
id -un                          # the user
ls -d ~/aleatory                # the checkout
readlink -f "$(which node)"     # node, absolutely
```

Then `/etc/systemd/system/aleatory-stats.service`:

```ini
[Unit]
Description=Aleatory stats bot
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=YOUR_USER
WorkingDirectory=/home/YOUR_USER/aleatory
EnvironmentFile=/home/YOUR_USER/aleatory/.env

# node and tsx by absolute path, not `npm run`. systemd has no shell profile,
# so nothing is on PATH: `npm` is frequently not in /usr/bin at all, and never
# is under nvm. npx would also try to resolve a package at start, over a
# network that may not be up yet.
ExecStart=/usr/bin/node /home/YOUR_USER/aleatory/node_modules/.bin/tsx bot/daemon.ts

Restart=always
RestartSec=10
KillSignal=SIGTERM
# The wait between passes is interruptible, so a stop is acted on when it
# arrives and not ten minutes later.
TimeoutStopSec=20

# It reads the chain, writes to Discord, and touches no file at all.
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=read-only

[Install]
WantedBy=multi-user.target
```

```
sudo systemctl daemon-reload
sudo systemctl enable --now aleatory-stats
systemctl status aleatory-stats --no-pager -l
```

No `ReadWritePaths`. The provider needs one because it writes; this holds no
state between passes and every figure is read fresh, so it needs the checkout
read-only and nothing else.

`ProtectHome=read-only` rather than `true`: the checkout is usually under
`/home`, and `true` hides it from the service.

### When it will not start

The failure to expect is systemd never launching the process, which reports as
a summary about unavailable resources. The journal is more specific:

| line | what is missing |
|---|---|
| `Failed to load environment files` | the `EnvironmentFile=` path |
| `Failed to spawn 'start' task` | the `ExecStart=` binary |

```
journalctl -u aleatory-stats --no-pager -n 50
```

`--no-pager` matters. Without it these open `less`, and a unit with no output
yet looks like it has hung.

### Reading the log

A healthy quiet run:

```
2026-08-31T08:35:58.416Z  shadownet, router KT1LWD8kiuyVzkSUAHKVovw6ymsjHcKykADc
2026-08-31T08:35:58.417Z  4 channels, every 10m
2026-08-31T08:35:59.108Z  announcing from generator 164643, mint 163537734336513, every 60s
2026-08-31T08:45:58.502Z  no figure changed
2026-08-31T09:02:11.330Z  announced 1
```

`no figure changed` is the normal line. Names are only written when a number
moves.

The `announcing from` line is the mark the bot started at. Those are event ids.
Everything at or below them was emitted before the process came up and is not
announced.

A refusal quotes Discord's own code rather than guessing at which permission
is behind it, because they are different screens in the settings:

| line | what it means |
| --- | --- |
| `read: Missing Access (50001)` | it cannot see the channel: no View Channel, or the channel is in a server the bot is not in |
| `read: Unknown Channel (10003)` | that id does not exist |
| `rename: Missing Permissions (50013)` | it can see the channel and cannot change it, so Manage Channel is missing |
| `post: Missing Permissions (50013)` | it can see the announcement channel and cannot speak in it, so Send Messages is missing |
| `rate limited, retry after Ns` | expected under a burst, the next pass writes it |
| `incomplete, nothing written` | a chain read failed, the names are left alone |

A post that is refused leaves the mark where it was, so the next pass tries the
same event again rather than stepping over it.

`npm run bot:doctor` asks those questions separately and names which one
failed, which is faster than reading them out of a rename.

It also works out what the bot may actually do in each channel, and checks that
against what that channel is for: a stat channel needs View Channel and Manage
Channels, an announcement channel needs View Channel, Send Messages and Embed
Links. Discord has no endpoint that answers this, so the doctor applies the
same rule Discord does, walking `@everyone`, then the bot's roles, then any
overwrite aimed at the bot itself. That last part is why reading a channel
proves nothing about posting in it: a server-wide permission is overridden by a
channel that denies it.

```
  ok         1410000000000000001  rename       "🎨 Generators: 12" in Aleatory
  FAILED     1543729359742050484  mints        "mints" in Aleatory
             missing Send Messages, Embed Links. Edit Channel, Permissions,
             add the bot, allow them there.
```

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
