import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
    turbopack: {
        resolveAlias: {
            "@clerk/nextjs": "./src/app/lib/auth",
        },
    },
    webpack: (config) => {
        config.resolve = config.resolve || {};
        config.resolve.alias = config.resolve.alias || {};
        config.resolve.alias["@clerk/nextjs"] = path.resolve(__dirname, "src/app/lib/auth.tsx");
        return config;
    },
};

export default nextConfig;
