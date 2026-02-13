import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
    // Monorepo: force Turbopack to treat alu-frontend as the app root.
    turbopack: {
        root: path.resolve(__dirname),
    },
};

export default nextConfig;
