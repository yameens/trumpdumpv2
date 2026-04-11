import type { NextConfig } from "next";
import path from "path";

const backendPath = path.resolve(__dirname, "../src/backend");

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.resolve(__dirname, ".."),

  webpack(config) {
    config.resolve = config.resolve ?? {};

    config.resolve.extensionAlias = { ".js": [".ts", ".js"] };

    config.resolve.alias = {
      ...(config.resolve.alias as Record<string, string>),
      "@backend": backendPath,
    };

    // Ensure backend files outside frontend/ can resolve packages from frontend/node_modules
    config.resolve.modules = [
      ...(config.resolve.modules ?? ["node_modules"]),
      path.resolve(__dirname, "node_modules"),
    ];

    return config;
  },
};

export default nextConfig;
