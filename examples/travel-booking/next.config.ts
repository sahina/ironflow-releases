import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.join(__dirname, "../.."),
  },
  transpilePackages: ["@ironflow/browser", "@ironflow/node", "@ironflow/core"],
};

export default nextConfig;
