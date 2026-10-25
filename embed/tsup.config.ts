import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "core/index": "src/core/index.ts",
    "libraries/index": "src/libraries/index.ts",
    "indexer/index": "src/indexer/index.ts",
    "viewer/index": "src/viewer/index.ts",
    "react/index": "src/react/index.ts"
  },
  format: ["esm", "cjs"],
  outExtension({ format }) {
    return {
      js: format === "esm" ? ".mjs" : ".cjs"
    };
  },
  dts: false,
  clean: false,
  sourcemap: true,
  splitting: false,
  external: ["react", "react-dom"]
});
