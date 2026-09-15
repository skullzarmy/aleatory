# Landing

What the mainnet address serves until the app itself does.

```
npm install
npm run dev      # http://localhost:3200
npm run build
```

One page. No chain reads, no wallet, no forms, so the policy in
`next.config.ts` denies everything a page like this never needs.

## Deploying it

Its own Netlify site, pointed at this repository with the base directory set
to `landing`. That is the whole of it: this directory builds on its own and
shares no module with the root app.

## Swapping it for the real site

Change that site's base directory from `landing` to the repository root and
redeploy. Nothing here has to be removed first, and nothing here is imported
by anything else, so it can be deleted whenever it stops being useful.

## Why it copies rather than imports

`src/lib/logo.ts`, the `Logo` component, the Tailwind theme and the design
tokens are copies of the root app's. Each site in this repo builds alone, the
way `admin/` does, so there is no shared module to break. The copies are the
cost of that: a change to the palette or the mark has to be made in both
places while this exists, which is one more reason for it not to exist for
long.

The one deliberate difference is dark mode. The app remembers a choice and
offers a toggle; a page somebody sees once follows the choice their system
already made, so the tokens here sit behind `prefers-color-scheme` rather than
a class.
