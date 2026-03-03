# Discord Bot Docker Deployment Design

## Goal

Replace the current brittle, hand-rolled Dockerfile with a `turbo prune --docker` based multi-stage build. Keep the image as small and lightweight as possible.

## Current Problem

The existing Dockerfile manually copies specific workspace files and then copies the entire monorepo `node_modules/` into the runtime image. This is wasteful and breaks when workspace dependencies change.

## Design

Four-stage Docker build:

### Stage 1: prepare

- Base: `node:20-slim`
- Install turbo globally
- Copy entire repo context
- Run `turbo prune @avoid.quest/discord-bot --docker`
- Output: `out/json/` (package.jsons + pruned lockfile) and `out/full/` (source)

### Stage 2: install

- Base: `node:20-slim`
- Install bun + native build tools (python3, make, g++) for `@discordjs/opus` and `sodium-native`
- Copy `out/json/` and pruned lockfile from prepare stage
- Run `bun install --frozen-lockfile`

### Stage 3: build

- Continue from install stage
- Copy `out/full/` (source code) from prepare stage
- Run tsup to bundle bot + `@avoid.quest/platforms` into a single ESM file
- `@discordjs/opus` and `sodium-native` stay external (native modules can't be bundled)

### Stage 4: runtime

- Base: `node:20-slim`
- Install only runtime deps: `ffmpeg`, `ca-certificates`
- Copy `dist/` bundle from build stage
- Copy only the native module subtrees from `node_modules/` (not the full tree)
- Run with `node dist/index.mjs`

### docker-compose.yml

No changes needed — already points at the right Dockerfile with repo root as context.

## Files to Change

1. `apps/discord-bot/Dockerfile` — rewrite with turbo prune pattern
2. `apps/discord-bot/docker-compose.yml` — no changes expected

## Deployment

Coolify clones the repo and builds from `apps/discord-bot/Dockerfile` with context at repo root. Environment variables are injected via Coolify's UI (same as current `.env` approach).
