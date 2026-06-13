FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json vitest.config.ts vitest.unit.config.ts ./
COPY prisma ./prisma
RUN pnpm prisma generate
COPY src ./src
RUN pnpm build

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=prod
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl curl \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma ./prisma
RUN pnpm install --prod --frozen-lockfile
RUN pnpm prisma generate
COPY --from=build /app/dist ./dist
COPY openapi.yaml ./openapi.yaml
EXPOSE 3000
CMD ["node", "dist/src/server.js"]
