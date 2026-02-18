import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
    // Monorepo: force Turbopack to treat alu-frontend as the app root.
    turbopack: {
        root: path.resolve(__dirname),
        resolveAlias: {
            "@clerk/nextjs": path.resolve(__dirname, "src/app/lib/auth.tsx"),
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
