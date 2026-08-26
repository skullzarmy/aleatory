# Deploying

Three things go up, and they are independent. Two are static-ish sites on
Netlify; one is a process you keep running.

```
isolate     a static page on its own domain, executes generator code
site        the Next app, everything a visitor sees
daemon      renders minted pieces and publishes their metadata
```

Nothing here is required to run Aleatory. The contracts are open and the
interface is [ALEATORY-001](interface.md); this is how *we* run it.

---

## Order

**Isolate first.** The site's CSP `frame-src` is built from
`NEXT_PUBLIC_ISOLATE_ORIGIN` at build time, so deploying the site before the
isolate has a host bakes `localhost` into the policy and needs a rebuild, not
just an environment change.

The daemon can go up any time. Nothing waits on it: pieces sit holding their
collection's pending document until it appears, and it renders whatever
accumulated.

---

## 1. The isolate

A single static file. No build step, no environment variables, no secrets.

Netlify site settings:

| | |
|---|---|
| Base directory | `isolate` |
| Publish directory | `.` |
| Build command | *(none)* |
| Environment | *(none)* |

Give it a domain of its own. Not a path on the app's domain: it runs code
published by strangers, and a separate origin is what keeps that away from
wallet state and session storage.

One isolate serves every network. It knows nothing about chains, it only runs
what it is handed over `postMessage`.

### frame-ancestors

`isolate/netlify.toml` lists who may frame it. Anything not on that list gets a
blank frame and nothing in the console beyond a CSP notice, which includes
Netlify's own `*.netlify.app` preview URLs. Add your hosts there before
concluding that previews are broken.

---

## 2. The site

Netlify site settings:

| | |
|---|---|
| Base directory | repository root |
| Build command | `npm run build` |
| Publish directory | `.next` |
| Plugin | `@netlify/plugin-nextjs` (already in `netlify.toml`) |

Environment: section 1 of `.env.example`, which is the block marked as the
Netlify one. Two of them are per-deployment and easy to leave wrong:

```
NEXT_PUBLIC_ISOLATE_ORIGIN=https://…   the host from step 1
NEXT_PUBLIC_SITE_URL=https://…         this site's own URL
```

`NEXT_PUBLIC_ROUTER_ADDRESS` is the only contract address needed. The router
holds the current factory, marketplace, registry and resolver, and every
retired factory, so collections from an old one stay visible.

Security headers live in `next.config.ts`, not in `netlify.toml`, because they
name hosts that are environment variables. A browser enforces the intersection
of two policies, so a second copy in `netlify.toml` would silently win wherever
it was stricter.

---

## 3. The provider daemon

```
npm run provider:daemon
```

It polls, renders what is waiting, pins the image, and publishes the token's
metadata. It refuses to start without `ALEA_PROVIDER_ADDRESS`, `ALEA_AGENT_SK`,
`PINATA_JWT` and the Cloudflare pair, rather than running half configured.

Section 2 of `.env.example` is its whole environment. It needs none of the
`NEXT_PUBLIC_` values, none of the deploy keys, and neither the admin nor the
treasury address. Only the agent key, which signs `set_token_metadata` and
nothing else.

### Run exactly one

Two daemons sharing an agent key both poll the same queue, both render the same
piece, and both sign from the same account. Tezos counters are sequential, so
one of every pair of concurrent operations is refused, and you pay Cloudflare
and Pinata twice for work that produces byte-identical output.

Nothing is corrupted by it. Renders are deterministic and
`set_token_metadata` is a plain rewrite. It is waste and noise.

For redundancy use failover, not parallelism. A daemon that has been down
loses nothing: the queue is "does this piece still hold its collection's
pending document", computed from chain state every pass, so whichever process
comes up next picks up everything missed.

### Stopping

`SIGINT` and `SIGTERM` finish the piece in flight and then exit, so nothing is
left half published. A second signal exits immediately. Give it a
`TimeoutStopSec` long enough to finish a render, around 60 seconds.

### Before wiring up a service

```
npm run provider:check
```

Reports what is waiting and changes nothing. If that works, the service will.

---

## Keeping the daemon running

### Linux, systemd

`/etc/systemd/system/aleatory-provider.service`:

```ini
[Unit]
Description=Aleatory render provider
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=aleatory
WorkingDirectory=/srv/aleatory
EnvironmentFile=/srv/aleatory/.env
ExecStart=/usr/bin/npm run provider:daemon

Restart=always
RestartSec=10
# Finish the piece in flight rather than publishing half of it.
KillSignal=SIGTERM
TimeoutStopSec=60

# It needs the network, its own directory and nothing else.
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/srv/aleatory

[Install]
WantedBy=multi-user.target
```

```
sudo systemctl daemon-reload
sudo systemctl enable --now aleatory-provider
journalctl -u aleatory-provider -f
```

`EnvironmentFile` does not understand quotes the way a shell does. Write
`PINATA_JWT=eyJ…` with no surrounding quotes, or systemd passes the quotes
through as part of the value and the daemon reports the credential as invalid.

### macOS, launchd

`~/Library/LaunchAgents/art.aleatory.provider.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>art.aleatory.provider</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/sh</string><string>-lc</string>
    <string>cd /Users/you/aleatory &amp;&amp; npm run provider:daemon</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/tmp/aleatory-provider.log</string>
  <key>StandardErrorPath</key><string>/tmp/aleatory-provider.err</string>
</dict>
</plist>
```

```
launchctl load -w ~/Library/LaunchAgents/art.aleatory.provider.plist
tail -f /tmp/aleatory-provider.log
```

`sh -lc` matters: launchd starts with almost no environment, so without a login
shell `node` is not on the path. The daemon reads `.env` itself, so only the
path needs solving here.

A LaunchAgent stops when the user logs out. For a machine that should serve
whether or not anyone is signed in, put it in `/Library/LaunchDaemons` and add
`<key>UserName</key>`.

### Windows

No native equivalent that handles restarts well. Two options that do:

**NSSM**, which wraps any command as a service:

```
nssm install AleatoryProvider "C:\Program Files\nodejs\npm.cmd" "run provider:daemon"
nssm set AleatoryProvider AppDirectory C:\aleatory
nssm start AleatoryProvider
```

**WSL2 with systemd**, which is the Linux instructions above and behaves
identically to production.

Task Scheduler works but has no real restart-on-crash behaviour, so a daemon
that dies stays dead until the next trigger.

### Docker, any OS

```dockerfile
FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
CMD ["npm", "run", "provider:daemon"]
```

```
docker run -d --restart=unless-stopped --env-file .env --name aleatory-provider aleatory
```

`--env-file` has the same no-quotes rule as systemd.

---

## Watching it

The daemon logs one line per piece with an ISO timestamp: what it picked up,
what it published, and the operation hash. A failed piece logs the reason and
stays in the queue for the next pass, so a burst of the same failure means
something is genuinely wrong rather than one bad piece.

A failure of the whole cycle, rather than of one piece, backs off doubling from
5 seconds to 5 minutes. Persistent backoff in the log means a dependency is
down, usually Cloudflare, Pinata, or the indexer.

To reach one piece by hand:

```
npm run provider:retry -- <KT1…> <token id>
```

`set_token_metadata` is deliberately a plain write rather than write-once, so a
piece whose publish landed without its confirmation being seen can be corrected
rather than being stuck forever.

---

## Moving to mainnet

Every value that differs is an environment variable, with one exception: the
contracts have to exist.

1. `npx tsx contract/deploy.ts` with four distinct addresses. The script
   refuses if any two match or if any is the deployer. See
   [audit-response.md](audit-response.md) for what the admin key holds before
   deciding where to keep it.
2. `NEXT_PUBLIC_TEZOS_NETWORK=mainnet` and the new
   `NEXT_PUBLIC_ROUTER_ADDRESS` on the site.
3. A provider contract and an agent for mainnet, then the daemon's
   `ALEA_PROVIDER_ADDRESS` and `ALEA_AGENT_SK`.

The isolate does not change. It never knew which chain it was on.
