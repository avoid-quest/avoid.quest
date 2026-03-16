# avoid.quest

Monorepo for avoid.quest apps. TanStack Start + Convex + Cloudflare.

## Apps

- **radio**: PWA internet radio player — 3 modes (Multiple/Single/DJ), audio mixing, effects, MIDI support
- **instarip**: Instagram post viewer — browse scraped IG content without an account
- **cwavasape**: Pinterest visual gallery with audio-reactive GPU shader effects
- **web**: Landing page and links hub

## Packages

- **backend**: Convex database + API — posts, users, media items, Telegram bot integration
- **platforms**: Platform scrapers and resolvers — Bandcamp, SoundCloud, YouTube, Radio Garden
- **error**: Shared error types, AppError, Sentry helpers
- **shared**: Shared utilities and feature flags
- **ui**: Component library (shadcn/ui + Radix UI)
- **typescript-config**: Shared TypeScript configs

## Tech Stack

- **Frontend**: TanStack Start, TanStack Router, React 19, TypeScript
- **State**: TanStack DB (localStorage collections), TanStack Store (runtime), TanStack Query (server state)
- **Backend**: Convex (database + real-time)
- **Styling**: Tailwind CSS v4, shadcn/ui
- **Tooling**: Bun, Turborepo, Biome (lint/format)
- **Deploy**: Cloudflare Workers

## Development

```bash
bun install          # Install dependencies
bun run dev          # Start all apps in dev mode
bun run dev:backend  # Start Convex backend only
bun run dev:setup    # First-time Convex setup
bun run build        # Build all apps
bun run typecheck    # Type check all packages
bun run check        # Lint (biome via ultracite)
bun run fix          # Auto-fix lint issues
bun run cleanup      # Clean node_modules and build artifacts
```

## Cloudflare Deployment

Each app deploys independently via Wrangler:

```bash
bun run cf-build     # Build all apps for Cloudflare
bun run cf-deploy    # Deploy all apps to Cloudflare
bun run cf-upload    # Upload new versions without promoting
bun run cf-typegen   # Regenerate Cloudflare environment type bindings
```

## Backend

```bash
bun run deploy:backend  # Deploy Convex to production
```

## UI Components

```bash
bun run ui           # Open shadcn/ui CLI for adding components to packages/ui
```

## Changesets

```bash
bun changeset        # Create a changeset
bun version-packages # Bump versions from changesets
```
