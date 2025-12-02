# avoid.quest

Monorepo for avoid.quest apps. Next.js + Convex + Cloudflare.

## Apps

- **instarip**: Instagram post viewer, browse scraped IG content without account
- **radio**: PWA internet radio player, 3 modes (Multiple/Single/DJ), audio mixing
- **web**: Landing page, links to instarip and radio

## Packages

- **backend**: Convex database, posts/users/media_items tables, queries/mutations
- **scraper**: Instagram scraper CLI, cron scheduler, Telegram bot integration
- **cacophony**: Advanced browser audio library (based on [Cacophony](https://github.com/ctoth/cacophony) by @ctoth, but with Bun runtime)
- **ui**: Shared component library, shadcn/ui + Radix UI, theme support
- **typescript-config**: Shared TS configs for all packages

## Tech Stack

- Next.js 16, React 19, TypeScript
- Convex (backend)
- Tailwind CSS v4, shadcn/ui
- Bun, Turbo (monorepo)
- Cloudflare Pages (deploy)

## Connections

- `scraper` → writes to `backend` → displayed in `instarip`
- All apps use `ui` components
- All packages use `typescript-config`

## Commands

### Development

```bash
bun install          # Install dependencies
bun run dev          # Start all apps
bun run dev:server   # Start Convex backend
bun run dev:setup    # Setup Convex backend
bun run build        # Build all
bun run check        # Lint + type check
bun run typecheck  # Type check only
bun run fix          # Auto-fix linting
bun run cleanup      # Clean all node_modules and build artifacts
```

### Scraper

```bash
bun scraper          # Run scraper CLI (pass commands after)
bun scraper start    # Start full system (scraper + telegram)
bun scraper scrape   # Run scraping once
bun scraper telegram # Send telegram messages once
bun scraper start-both # Run both jobs in sequence
bun scraper cron:start # Start cron scheduler
bun scraper cron:status # Check cron status
```

### Scraper Build (packages/scraper)

```bash
cd packages/scraper
bun run build        # Build for current platform
bun run build:linux  # Build Linux binary
bun run build:macos-x64 # Build macOS Intel binary
bun run build:macos-arm64 # Build macOS ARM binary
bun run build:windows # Build Windows binary
bun run build:all    # Build all platforms
```

### Cloudflare

```bash
bun run cf-build     # Build all apps for Cloudflare
bun run cf-deploy    # Deploy all apps to Cloudflare
bun run cf-upload    # Upload all apps to Cloudflare
bun run cf-typegen   # Generate Cloudflare types
```

### Changesets

```bash
bun changeset add     # Create new changeset
bun changeset version # Version packages
bun changeset tag    # Create git tags for releases
```

### UI Components

```bash
bun run ui           # Open shadcn/ui CLI
```
