/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
import "./src/env.js";

/** @type {import("next").NextConfig} */
const config = {
  // Fix the lockfile warning by setting the correct root
  outputFileTracingRoot: "/home/carlos/Development/tapestry",
  // Enable long-running API routes for SSE
  serverExternalPackages: [],
  // Increase timeout for SSE connections
  serverRuntimeConfig: {
    maxRequestTimeout: 300000, // 5 minutes
  },
};

export default config;
