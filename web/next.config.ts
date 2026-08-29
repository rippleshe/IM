import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 挑战杯交付：standalone 产物供容器化运行（web/Dockerfile）
  output: "standalone",
  // pnpm workspace + turbopack：root 必须指向 lockfile 所在的 workspace 根，
  // 否则容器内 .pnpm 符号链接在项目目录之外、无法解析 next 包
  turbopack: { root: path.resolve(process.cwd(), "..") },
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
