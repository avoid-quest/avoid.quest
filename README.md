# avoid.quest

Monorepo for avoid.quest apps. Next.js + Convex + Cloudflare.

## Apps

- **instarip**: Instagram post viewer, browse scraped IG content without account
- **radio**: PWA internet radio player, 3 modes (Multiple/Single/DJ), audio mixing
- **web**: Landing page, links to instarip and radio

## Packages

- **backend**: Convex database, posts/users/media_items/post_metadata tables, AI metadata extraction via Groq
- **bandcamp**: Bandcamp metadata scraper, extracts tracks/albums/stream URLs
- **soundcloud**: SoundCloud metadata scraper, extracts tracks/playlists/stream URLs
- **ui**: Shared component library, shadcn/ui + Radix UI, theme support
- **typescript-config**: Shared TS configs for all packages

## Tech Stack

- Next.js 16, React 19, TypeScript
- Convex (backend)
- Tailwind CSS v4, shadcn/ui
- Bun, Turbo (monorepo)
- Cloudflare Pages (deploy)

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
