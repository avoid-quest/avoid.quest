FROM node:20-slim AS prepare

RUN npm install -g turbo@2.8.12

WORKDIR /app
COPY . .
RUN turbo prune @avoid.quest/discord-bot --docker

# ---

FROM node:20-slim AS install

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ curl unzip ca-certificates \
  && curl -fsSL https://bun.sh/install | bash -s "bun-v1.3.10" \
  && rm -rf /var/lib/apt/lists/*

ENV PATH="/root/.bun/bin:$PATH"

WORKDIR /app

COPY --from=prepare /app/out/json/ .
RUN bun install --frozen-lockfile

# ---

FROM install AS build

COPY --from=prepare /app/out/full/ .

RUN cd apps/discord-bot && npx tsup src/index.ts \
  --format esm \
  --target node20 \
  --clean \
  --noExternal '/./' \
  --external @discordjs/opus \
  --external sodium-native

# Collect native modules + their transitive deps into a clean node_modules
RUN mkdir -p /native-deps && \
  echo '{"dependencies":{"@discordjs/opus":"0.9.0","sodium-native":"4.3.3"}}' \
  > /native-deps/package.json && \
  cd /native-deps && bun install --production

# ---

FROM node:20-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=build /app/apps/discord-bot/dist/ ./dist/
COPY --from=build /native-deps/node_modules/ ./node_modules/

CMD ["node", "dist/index.mjs"]
