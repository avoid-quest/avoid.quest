FROM node:20-slim AS base

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ curl unzip ca-certificates \
  && curl -fsSL https://bun.sh/install | bash -s "bun-v1.3.10" \
  && rm -rf /var/lib/apt/lists/*

ENV PATH="/root/.bun/bin:$PATH"

# ---

FROM base AS prepare

WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile
RUN bunx turbo prune @avoid.quest/discord-bot --docker

# ---

FROM base AS install

WORKDIR /app

COPY --from=prepare /app/out/json/ .
RUN printf '[install]\nlinker = "hoisted"' > bunfig.toml
RUN bun install --frozen-lockfile

# ---

FROM install AS build

COPY --from=prepare /app/out/full/ .

RUN cd apps/discord-bot && bunx tsup

# ---

FROM node:20-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=build /app/apps/discord-bot/dist/ ./dist/
COPY --from=build /app/node_modules/ ./node_modules/

CMD ["node", "dist/index.cjs"]
