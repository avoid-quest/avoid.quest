# Development

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
bun install --frozen-lockfile # Install dependencies
bun run secrets:setup # Select the avoid-quest/dev_personal Doppler config
bun run dev          # Start workspace dev tasks with Doppler-backed app scripts
bun run build        # Build all apps/packages
bun run typecheck    # Type check all packages
bun run check        # Lint/format check via Ultracite
bun run fix          # Auto-fix lint/format issues
```

Radio runs without credentials using `bun run --filter @avoid.quest/radio dev`.
Builds and tests also run without private credentials. The web and bot development
scripts use Doppler; for a credential-free marketing preview, build web then run
`bun run --filter @avoid.quest/web preview`.

For maintainer integrations, local development secrets are managed through Doppler. Install the Doppler CLI,
run `doppler login` once for your machine, then run `bun run secrets:setup` from
the repository root. The committed `doppler.yaml` preselects the
`avoid-quest` project and `dev_personal` config, matching Doppler's recommended
repo-root setup flow for monorepos.

Scoped examples:

```bash
bun run --filter @avoid.quest/web dev
bun run --filter @avoid.quest/radio dev
bun run --filter @avoid.quest/discord-bot dev
```

Use `bun run secrets:status` to inspect which Doppler project/config is active
for the repository root. Doppler is the development secrets source of truth; do
not create or commit plaintext `.env`, `.dev.vars`, service tokens, or
downloaded secret files for normal local development.

## Cloudflare deployment

Deployable apps keep their Wrangler configuration under `apps/*/wrangler.jsonc`.
Do not deploy from automation unless the task explicitly asks for deployment.

Workers `workers.dev` exposure and preview URLs are enabled in committed
Wrangler config:

Non-production Workers Builds should publish preview URLs in PR comments.

| App | `workers_dev` | `preview_urls` | Production exposure |
|-----|---------------|----------------|---------------------|
| `@avoid.quest/web` | Enabled | Enabled | Use `workers.dev` plus Cloudflare account-level custom domains or routes as needed. |
| `@avoid.quest/radio` | Enabled | Enabled | Use `workers.dev` plus Cloudflare account-level custom domains or routes as needed. |

Custom production hostnames and any production-only overrides are intentionally
kept out of the public repository. Configure them in Cloudflare before
deploying.

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
