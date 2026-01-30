# avoid.quest

Monorepo for avoid.quest apps. TanStack Start + Convex + Cloudflare.

## Apps

- **instarip**: Instagram post viewer - browse scraped IG content without an account
- **radio**: PWA internet radio player - 3 modes (Multiple/Single/DJ), audio mixing
- **cwavasape**: Pinterest visual gallery with AI effects and GPU shaders
- **web**: Landing page and links hub

## Packages

- **backend**: Convex database + API for posts, users, media items, Telegram integration
- **bandcamp**: Bandcamp metadata scraper - tracks, albums, stream URLs
- **soundcloud**: SoundCloud metadata scraper - tracks, playlists, stream URLs
- **pinterest**: Pinterest board/pin scraper
- **shared**: Shared utilities and feature flags
- **ui**: Component library (shadcn/ui + Radix UI)
- **typescript-config**: Shared TypeScript configs

## Tech Stack

- TanStack Start, TanStack Router, React 19, TypeScript
- Convex (backend database + real-time)
- Tailwind CSS v4, shadcn/ui
- Bun, Turborepo
- Cloudflare Workers (deploy)

## Development

```bash
bun install          # Install dependencies
bun run dev          # Start all apps in dev mode
bun run dev:backend  # Start Convex backend only
bun run dev:setup    # First-time Convex setup
bun run build        # Build all apps
bun run typecheck    # Type check all packages
bun run check        # Lint (ultracite/biome)
bun run fix          # Auto-fix lint issues
bun run cleanup      # Clean node_modules and build artifacts
```

## Cloudflare Deployment

```bash
bun run cf-build     # Build for Cloudflare
bun run cf-deploy    # Deploy to Cloudflare
bun run cf-typegen   # Generate Cloudflare types
```

## Backend

```bash
bun run deploy:backend  # Deploy Convex to production
```

## UI Components

```bash
bun run ui           # Open shadcn/ui CLI for adding components
```

## Changesets

```bash
bun changeset        # Create a changeset
bun version-packages # Version packages from changesets
```
