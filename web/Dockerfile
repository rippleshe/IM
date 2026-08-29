# IM-Training-Agent Web 前端镜像（Next.js standalone，:3000）
FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable
# pnpm v11 在运行脚本前自动 install（verify-deps）；容器构建期按 lockfile 定向安装，必须关闭
ENV npm_config_verify_deps_before_run=false

FROM base AS deps
# workspace 完整清单：pnpm-lock.yaml 同时包含根项目与 web 两个 importer
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY web/package.json ./web/
RUN pnpm install --frozen-lockfile --ignore-scripts

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/web/node_modules ./web/node_modules
COPY web ./web
# 绕过 pnpm 的 deps 状态检查直接执行 next build（构建期无 registry 访问）
RUN cd web && ./node_modules/.bin/next build

FROM base AS runtime
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# turbopack.root=workspace 根 → standalone 嵌套为 standalone/web/server.js
COPY --from=build /app/web/.next/standalone ./
COPY --from=build /app/web/.next/static ./web/.next/static
COPY --from=build /app/web/public ./web/public
EXPOSE 3000
CMD ["node", "web/server.js"]
