FROM node:20-slim AS prepare

RUN npm install -g turbo@^2

WORKDIR /app
COPY . .
RUN turbo prune @avoid.quest/discord-bot --docker

# ---

FROM node:20-slim AS install

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ curl unzip ca-certificates \
  && curl -fsSL https://bun.sh/install | bash \
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
  --noExternal @avoid.quest/platforms \
  --external @discordjs/opus \
  --external sodium-native

# ---

FROM node:20-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=build /app/apps/discord-bot/dist/ ./dist/
COPY --from=build /app/node_modules/@discordjs/opus/ ./node_modules/@discordjs/opus/
COPY --from=build /app/node_modules/sodium-native/ ./node_modules/sodium-native/
COPY --from=build /app/node_modules/node-gyp-build/ ./node_modules/node-gyp-build/

CMD ["node", "dist/index.mjs"]
