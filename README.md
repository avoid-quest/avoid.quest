# avoid.quest

Bun/Turborepo monorepo for the active avoid.quest apps and shared packages.

This repository is source-available, not open source. See [LICENSE](./LICENSE)
for usage restrictions, [SECURITY.md](./SECURITY.md) for vulnerability
reporting, and [CONTRIBUTING.md](./CONTRIBUTING.md) for contribution
expectations.

## Apps

- **web** (`apps/web`): Astro landing page and links hub.
- **radio** (`apps/radio`): TanStack Start PWA internet radio player with multi-mode playback, platform resolvers, audio effects, MIDI support, and Cloudflare Worker deployment.
- **discord-bot** (`apps/discord-bot`): Discord bot for avoid.quest radio/platform interactions.

## Packages

- **config** (`packages/config`): Shared TypeScript configuration.
- **error** (`packages/error`): Shared error types, `AppError`, and Sentry helpers.
- **platforms** (`packages/platforms`): Platform scrapers and resolvers for Bandcamp, SoundCloud, YouTube, and Radio Garden.
- **ui** (`packages/ui`): Shared React UI components, shadcn/ui primitives, and branding assets.

## Tech stack

- **Runtime/package manager**: Bun
- **Monorepo**: Turborepo
- **Lint/format**: Ultracite/Biome
- **Web**: Astro, React islands, Tailwind CSS v4
- **Radio**: TanStack Start, TanStack Router, React 19, TypeScript, Web Audio API
- **Bot**: Discord.js, TypeScript, tsup
- **Deploy**: Cloudflare Workers for deployable web apps

## Development

```bash
bun install          # Install dependencies
bun run dev          # Start workspace dev tasks
bun run build        # Build all apps/packages
bun run typecheck    # Type check all packages
bun run check        # Lint/format check via Ultracite
bun run fix          # Auto-fix lint/format issues
```

Scoped examples:

```bash
bun run --filter @avoid.quest/web dev
bun run --filter @avoid.quest/radio dev
bun run --filter @avoid.quest/discord-bot dev
```

## Cloudflare deployment

Deployable apps keep their Wrangler configuration under `apps/*/wrangler.jsonc`.
Do not deploy from automation unless the task explicitly asks for deployment.

Public preview exposure is disabled in committed Wrangler config:

| App | `workers_dev` | `preview_urls` | Production exposure |
|-----|---------------|----------------|---------------------|
| `@avoid.quest/web` | Disabled | Disabled | Use Cloudflare account-level custom domains or routes for the production hostname. |
| `@avoid.quest/radio` | Disabled | Disabled | Use Cloudflare account-level custom domains or routes for the production hostname. |

Production hostnames and any production-only overrides are intentionally kept
out of the public repository. Configure them in Cloudflare before deploying.

```bash
bun run cf-build     # Build Cloudflare-targeted apps
bun run cf-deploy    # Deploy Cloudflare-targeted apps
bun run cf-upload    # Upload versions without promoting
bun run cf-typegen   # Regenerate Cloudflare environment type bindings
```

## UI components

```bash
bun run ui add <component-name>
```
