# IM-Training-Agent Web 前端镜像（Next.js standalone，:3000）
FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable

FROM base AS deps
COPY web/package.json pnpm-lock.yaml ./web/
RUN cd web && pnpm install --frozen-lockfile --ignore-scripts

FROM base AS build
COPY --from=deps /app/web/node_modules ./web/node_modules
COPY web ./web
RUN cd web && pnpm build

FROM base AS runtime
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
COPY --from=build /app/web/.next/standalone ./
COPY --from=build /app/web/.next/static ./web/.next/static
COPY --from=build /app/web/public ./web/public
EXPOSE 3000
CMD ["node", "web/server.js"]
