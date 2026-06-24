/** @type {import('next').NextConfig} */

// When DEMO=1 we build for the GitHub Pages view-only demo, served from the
// /rosie sub-path. basePath rewrites all asset + link URLs so a crawled static
// snapshot works under https://<user>.github.io/rosie/.
const demo = process.env.DEMO === "1";
const basePath = process.env.PAGES_BASE_PATH || "/rosie";

const nextConfig = {
  reactStrictMode: true,
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
