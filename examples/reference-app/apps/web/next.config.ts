import type { NextConfig } from "next";
import path from "node:path";

// The repository root, not this directory. `@ironflow/browser` is a workspace
// link into ../../../../sdk/js/browser, so both the bundler's resolution root
// and the output tracer have to start above it or the import cannot be found.
const REPO_ROOT = path.resolve(import.meta.dirname, "../../../..");

const config: NextConfig = {
  turbopack: { root: REPO_ROOT },
  // The supervisor announces a 127.0.0.1 URL while Next advertises localhost,
  // and Next 16 blocks dev resources requested from an origin it did not expect
  // — which kills HMR and the dev runtime on the exact URL a presenter opens.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  outputFileTracingRoot: REPO_ROOT,
};

export default config;
