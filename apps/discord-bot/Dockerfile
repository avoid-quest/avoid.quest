# --- PREPARE: prune monorepo ---

FROM node:24-alpine AS prepare

RUN npm i -g turbo@2.10.12

WORKDIR /app
COPY . .
RUN turbo prune @avoid.quest/discord-bot --docker

# --- BASE: bun + native build tools ---

FROM node:24-alpine AS base

RUN apk add --no-cache python3 make g++ curl bash unzip

RUN curl -fsSL https://bun.sh/install | bash -s "bun-v1.4.0"

ENV PATH="/root/.bun/bin:$PATH"

# --- BUILD: install all deps + compile ---

FROM base AS build

WORKDIR /app

COPY --from=prepare /app/out/json/ .
COPY --from=prepare /app/out/bun.lock ./bun.lock
RUN printf '[install]\nlinker = "hoisted"' > bunfig.toml
RUN bun install --frozen-lockfile

COPY --from=prepare /app/out/full/ .
RUN cd apps/discord-bot && bun x tsup

# --- PRODINSTALL: production deps only ---

FROM base AS prodinstall

WORKDIR /app

COPY --from=prepare /app/out/json/ .
COPY --from=prepare /app/out/bun.lock ./bun.lock
RUN printf '[install]\nlinker = "hoisted"' > bunfig.toml
RUN bun install --frozen-lockfile --omit dev

# --- RUNTIME ---

FROM node:24-alpine AS runtime

RUN apk add --no-cache ffmpeg

RUN adduser -D -u 1001 botuser

WORKDIR /app

COPY --from=build --chown=botuser:botuser /app/apps/discord-bot/dist/ ./dist/
COPY --from=prodinstall --chown=botuser:botuser /app/node_modules/ ./node_modules/

USER botuser

CMD ["node", "dist/index.cjs"]
