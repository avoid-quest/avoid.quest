# --- PREPARE: prune monorepo ---

FROM node:24-bookworm-slim AS prepare

RUN npm i -g turbo@2.11.6

WORKDIR /app
COPY . .
RUN turbo prune @avoid.quest/discord-bot --docker

# --- BASE: bun + native build tools ---

FROM node:24-bookworm-slim AS base

RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ curl ca-certificates unzip && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://bun.sh/install | bash -s "bun-v1.4.2"

ENV PATH="/root/.bun/bin:$PATH"

# --- BUILD: install all deps + compile ---

FROM base AS build

WORKDIR /app

COPY --from=prepare /app/out/json/ .
COPY --from=prepare /app/out/bun.lock ./bun.lock
RUN printf '[install]\nlinker = "hoisted"' > bunfig.toml
# Opus 0.10 compiles its ARM64 NEON sources without enabling their declarations.
# Keep the upstream native codec; expose those declarations for source builds.
RUN if [ "$(uname -m)" = "aarch64" ]; then export CFLAGS="-DOPUS_ARM_MAY_HAVE_NEON_INTR"; fi; \
    bun install --frozen-lockfile

COPY --from=prepare /app/out/full/ .
RUN cd apps/discord-bot && bun x tsup

# --- PRODINSTALL: production deps only ---

FROM base AS prodinstall

WORKDIR /app

COPY --from=prepare /app/out/json/ .
COPY --from=prepare /app/out/bun.lock ./bun.lock
RUN printf '[install]\nlinker = "hoisted"' > bunfig.toml
# Opus 0.10 compiles its ARM64 NEON sources without enabling their declarations.
# Keep the upstream native codec; expose those declarations for source builds.
RUN if [ "$(uname -m)" = "aarch64" ]; then export CFLAGS="-DOPUS_ARM_MAY_HAVE_NEON_INTR"; fi; \
    bun install --frozen-lockfile --omit dev

# --- RUNTIME ---

FROM node:24-bookworm-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --uid 1001 botuser

WORKDIR /app

COPY --from=build --chown=botuser:botuser /app/apps/discord-bot/dist/ ./dist/
COPY --from=prodinstall --chown=botuser:botuser /app/node_modules/ ./node_modules/

USER botuser

CMD ["node", "dist/index.cjs"]
