/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@ironflow/browser", "@ironflow/core"],
};

module.exports = nextConfig;
