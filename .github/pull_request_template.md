## What this changes

<!-- The behaviour, not the diff. Somebody reading this in a year should
     understand what was different afterwards. -->

## Why

<!-- What was wrong, or what was missing. If it fixes something, say how to
     see it happen. -->

## What you ran

<!-- CI runs lint, types, tests and the build. Anything it cannot run is the
     part worth mentioning: a page you loaded, a mint you signed, a scenario
     you stepped through. -->

- [ ] `npm test`
- [ ] `npm run build`
- [ ] Looked at it in a browser, if it changes something anybody sees

## Contracts

<!-- Delete this section if you did not touch contract/. -->

- [ ] `npm run test:contracts` passes
- [ ] `npm run build:contracts` compiles
- [ ] The storage in `contract/deploy.ts` still matches what the contract declares

Changing a contract means a new factory, and reaches nothing already deployed.
[CONTRIBUTING.md](../CONTRIBUTING.md) has the rest.
