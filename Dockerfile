# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS base
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

FROM base AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/pwa/package.json ./apps/pwa/
COPY packages/core/package.json ./packages/core/
RUN npm ci

FROM dependencies AS build
WORKDIR /app
COPY . .
RUN npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV TZ=America/Sao_Paulo

COPY --from=build /app /app

EXPOSE 3000

# Executa migrações pendentes e sobe o servidor da API
CMD ["sh", "-c", "node apps/api/dist/migrate.js && node apps/api/dist/server.js"]
