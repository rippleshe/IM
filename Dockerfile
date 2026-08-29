# IM-Training-Agent 挑战杯运行镜像（api 与 worker 共用）
FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable
# pnpm v11 在运行脚本前自动 install（verify-deps）；容器构建期无 registry 访问，必须关闭
ENV npm_config_verify_deps_before_run=false

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json tsup.config.ts ./
COPY src ./src
COPY server ./server
COPY scripts ./scripts
RUN pnpm build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# 迁移 SQL 与引导数据：bootstrap 服务建表 + 导入知识卡/AI4I/Metro（总规 §6.3、§10）
COPY --from=build /app/server/db/drizzle ./server/db/drizzle
COPY data/knowledge ./data/knowledge
COPY data/datasets/ai4i/ai4i_2020.csv ./data/datasets/ai4i/ai4i_2020.csv
COPY package.json ./
EXPOSE 3001
CMD ["node", "dist/server.js"]
