FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
COPY prisma ./prisma
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json vitest.config.ts vitest.unit.config.ts ./
COPY src ./src
RUN npm run build

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=prod
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl curl \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY openapi ./openapi
EXPOSE 3000
USER node
CMD ["node", "dist/src/server.js"]
