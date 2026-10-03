#!/usr/bin/env -S npx tsx
/**
 * On a Netlify deploy preview, the app's own isolate origin env var would
 * otherwise still point at production, so a preview page frames the
 * production isolate (which refuses it) instead of the isolate preview built
 * for the same PR. Netlify injects CONTEXT and REVIEW_ID into every build
 * command already; this writes the matching origin to .env.local, which
 * Next.js loads before build with no further wiring.
 *
 * A no-op outside deploy-preview context: production and branch deploys keep
 * using the NEXT_PUBLIC_ISOLATE_ORIGIN already set in the Netlify UI.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const { CONTEXT, REVIEW_ID } = process.env;

if (CONTEXT !== "deploy-preview" || !REVIEW_ID) {
    console.log("build-preview-env: not a deploy preview, skipping");
    process.exit(0);
}

const origin = `https://deploy-preview-${REVIEW_ID}--isolated-aleatory.netlify.app`;
writeFileSync(join(process.cwd(), ".env.local"), `NEXT_PUBLIC_ISOLATE_ORIGIN=${origin}\n`);
console.log(`build-preview-env: wrote NEXT_PUBLIC_ISOLATE_ORIGIN=${origin}`);
