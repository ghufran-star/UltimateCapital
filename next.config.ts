import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["pdf-lib"],
  experimental: { serverActions: { bodySizeLimit: "10mb" } },
};

export default nextConfig;
