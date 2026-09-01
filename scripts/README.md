# Scripts

Operator commands and build steps. Every one of them does its work when you run
it; `--dry-run` is how you ask it to show you instead.

The two long-running programs live beside their own code, in
[`provider/`](../provider/) and [`bot/`](../bot/), each with a README covering
what its environment needs.

```
npm run provider:daemon               draws minted pieces and publishes them
npm run bot:daemon                    writes chain figures into Discord
```

## Deploying

```
npm run deploy                        originate the platform contracts
npm run deploy:collection             one collection, for testing
```

[deploying.md](../docs/deploying.md) is the guide.

## Build steps

```
npm run templates:build               starter kits from public/templates
npm run build:icons                   favicons and the mark
npm run logo                          preview the generated logo
```

`templates:build` runs before `dev` and `build`, so the module the studio
imports and the kits on the site cannot be stale.

## Checks

```
npm test
```

Includes `check-links.mjs` and `check-refs.mjs`, which walk every relative link,
file path and `npm run` command named in the documentation and fail on anything
that does not exist. They exist because prose rots quietly: a renamed script
leaves a sentence that still reads fine and sends somebody to a command that is
gone.
