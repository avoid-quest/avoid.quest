# Discord Bot Docker Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the hand-rolled Dockerfile with a `turbo prune --docker` multi-stage build for a minimal, maintainable Docker image.

**Architecture:** Four-stage build — prune the monorepo, install pruned deps, bundle with tsup, copy only the bundle + native modules to a slim runtime image.

**Tech Stack:** turbo prune, bun, tsup, node:20-slim, ffmpeg

---

### Task 1: Add .dockerignore

**Files:**
- Create: `.dockerignore`

**Step 1: Create .dockerignore at repo root**

```
node_modules
.git
.next
out
dist
.turbo
.env*
*.md
.changeset
.claude
```

This prevents the full `node_modules` and `.git` from being sent as Docker build context, which would be slow and wasteful.

**Step 2: Commit**

```bash
git add .dockerignore
git commit -m "chore(discord-bot): add .dockerignore to speed up docker builds"
```

---

### Task 2: Rewrite Dockerfile with turbo prune

**Files:**
- Modify: `apps/discord-bot/Dockerfile`

**Step 1: Replace the Dockerfile with the turbo prune multi-stage build**

```dockerfile
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
```

Key decisions:
- `prepare` stage: turbo prune generates `out/json/` (package.jsons + lockfile) and `out/full/` (source)
- `install` stage: bun installs from pruned lockfile only — source changes don't bust this cache
- `build` stage: tsup bundles everything except native modules into one file
- `runtime` stage: only the bundle + native modules + ffmpeg — no bun, no turbo, no source code
- `node-gyp-build` is a runtime dep of `sodium-native` so it must be copied too

**Step 2: Verify docker-compose.yml is still correct**

Read `apps/discord-bot/docker-compose.yml` — it should already have `context: ../..` and `dockerfile: apps/discord-bot/Dockerfile`. No changes needed.

**Step 3: Commit**

```bash
git add apps/discord-bot/Dockerfile
git commit -m "chore(discord-bot): rewrite Dockerfile with turbo prune for minimal image"
```

---

### Task 3: Test the Docker build

**Step 1: Build the image**

```bash
docker build -f apps/discord-bot/Dockerfile -t avoid-discord-bot .
```

Run from repo root. Verify all four stages complete without errors.

**Step 2: Inspect the image size**

```bash
docker images avoid-discord-bot
```

Should be significantly smaller than before (no full monorepo node_modules).

**Step 3: Verify the runtime image contents**

```bash
docker run --rm avoid-discord-bot ls -la /app/dist/
docker run --rm avoid-discord-bot ls -la /app/node_modules/
docker run --rm avoid-discord-bot ffmpeg -version
docker run --rm avoid-discord-bot node -e "require('@discordjs/opus')"
```

Verify: dist/index.mjs exists, only 3 native module dirs in node_modules, ffmpeg works, opus loads.

**Step 4: Smoke test the bot (optional, needs env vars)**

```bash
docker run --rm --env-file apps/discord-bot/.env avoid-discord-bot
```

Should print "Logged in as <bot-name>" and connect. Ctrl+C to stop.
