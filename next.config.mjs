/** @type {import('next').NextConfig} */
import { createHash } from "node:crypto";

// When DEMO=1 we build for the GitHub Pages view-only demo, served from the
// /rosie sub-path. basePath rewrites all asset + link URLs so a crawled static
// snapshot works under https://<user>.github.io/rosie/.
const demo = process.env.DEMO === "1";
const basePath = process.env.PAGES_BASE_PATH || "/rosie";

// The password gate. Server builds check a cookie in middleware; the static demo
// build has no server, so its gate runs in the browser against this digest.
const gatePassword = process.env.SITE_PASSWORD || "Foundational";
const gateDigest = createHash("sha256").update(`${gatePassword}|rosie-gate-v1`).digest("hex");

const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_GATE_MODE: demo ? "client" : "server",
    NEXT_PUBLIC_GATE_DIGEST: gateDigest,
  },
  experimental: {
    serverComponentsExternalPackages: ["xlsx"],
  },
  ...(demo
    ? {
        basePath,
        assetPrefix: basePath,
        images: { unoptimized: true },
      }
    : {}),
};

export default nextConfig;
