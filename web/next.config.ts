import fs from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

// One .env for the whole project: load the repository-root file
// (APP_DATABASE_URL, SESSION_SECRET). Variables already set win.
const rootEnv = path.resolve(process.cwd(), "..", ".env");
if (fs.existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  images: {
    remotePatterns: [{ protocol: "https", hostname: "raw.githubusercontent.com", pathname: "/PokeAPI/sprites/**" }],
  },
};

export default nextConfig;
