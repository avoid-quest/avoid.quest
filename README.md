# avoid.quest

Core avoid.quest monorepo for the landing site, radio app, Discord bot, and shared packages that still belong to the main avoid.quest project.

> Split note: `cwavasape` and `instarip` now live in their own private repositories under the `avoid-quest` GitHub organization.

## Apps

- **web** (`apps/web`): Astro landing page and links hub.
- **radio** (`apps/radio`): PWA internet radio player with multi-mode playback, platform resolvers, audio effects, MIDI support, and Cloudflare Worker deployment.
- **discord-bot** (`apps/discord-bot`): Discord bot for avoid.quest radio/platform interactions.

## Packages

- **config** (`packages/config`): Shared TypeScript configuration.
- **error** (`packages/error`): Shared error types, `AppError`, and Sentry helpers.
- **platforms** (`packages/platforms`): Platform scrapers and resolvers for Bandcamp, SoundCloud, YouTube, and Radio Garden.
- **ui** (`packages/ui`): Shared React UI components, shadcn/ui primitives, and branding assets.

## Related repositories

- **cwavasape**: split to `avoid-quest/cwavasape`.
- **instarip**: split to `avoid-quest/instarip` and kept as an archived project with its pruned Convex backend.

## Tech stack

- **Web**: Astro, React islands, Tailwind CSS v4.
- **Radio**: TanStack Start, TanStack Router, React 19, TypeScript, Web Audio API.
- **Bot**: Discord.js, TypeScript, tsup.
- **Tooling**: Bun, Turborepo, Ultracite/Biome.
- **Deploy**: Cloudflare Workers for deployable web apps.

## Development

```bash
bun install          # Install dependencies
bun run dev          # Start workspace dev tasks
bun run build        # Build all apps/packages
bun run typecheck    # Type check all packages
bun run check        # Lint/format check via Ultracite
bun run fix          # Auto-fix lint/format issues
bun run cleanup      # Clean node_modules and build artifacts
```

Scoped examples:

```bash
bun run --filter @avoid.quest/web dev
bun run --filter @avoid.quest/radio dev
bun run --filter @avoid.quest/discord-bot dev
```

## Cloudflare deployment

Deployable apps have their own Wrangler configuration under `apps/*/wrangler.jsonc`.

```bash
bun run cf-build     # Build Cloudflare-targeted apps
bun run cf-deploy    # Deploy Cloudflare-targeted apps
bun run cf-upload    # Upload versions without promoting
bun run cf-typegen   # Regenerate Cloudflare environment type bindings
```

Do not deploy from automation unless the task explicitly asks for deployment.

## UI components

```bash
bun run ui           # Open shadcn/ui CLI for packages/ui
```
