import type { NextConfig } from "next";
import path from "path";

const backendPath = path.resolve(__dirname, "../src/backend");

const nextConfig: NextConfig = {
  webpack(config) {
    config.resolve = config.resolve ?? {};

    config.resolve.extensionAlias = { ".js": [".ts", ".js"] };

    config.resolve.alias = {
      ...(config.resolve.alias as Record<string, string>),
      "@backend": backendPath,
    };

    return config;
  },
};

export default nextConfig;
