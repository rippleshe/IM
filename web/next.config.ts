import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 挑战杯交付：standalone 产物供容器化运行（web/Dockerfile）
  output: "standalone",
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://localhost:3001/api/:path*",
      },
    ];
  },
};

export default nextConfig;
