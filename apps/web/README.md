# web

Astro landing page for avoid.quest.

## Features

- Homepage with avoid.quest branding and links to active apps.
- Local Astro theme toggle with the preference stored in localStorage.
- Static-first Astro app deployed through Cloudflare.

## Tech stack

- Astro
- React islands
- Tailwind CSS v4
- Cloudflare Workers via `@astrojs/cloudflare`

## Routes

- `/` — Prerendered landing page with active avoid.quest links.
- `/legal` — Prerendered source and license information.
- `/u/*` — Server endpoint forwarding analytics requests to the fixed Umami
  origin in [`src/pages/u/[...path].ts`](src/pages/u/[...path].ts).

## Configuration

[`astro.config.ts`](astro.config.ts) configures the Cloudflare adapter,
React integration and Tailwind Vite plugin. [`wrangler.jsonc`](wrangler.jsonc)
sets the Worker entrypoint, assets and compatibility flags. TypeScript extends
`astro/tsconfigs/strict` in [`tsconfig.json`](tsconfig.json).

## Development

`dev` uses Doppler; complete the [repository setup](../../DEVELOPMENT.md) first.
Build and preview require no private credentials:

```bash
# From the repository root
bun run --filter @avoid.quest/web dev
bun run --filter @avoid.quest/web build
bun run --filter @avoid.quest/web preview
bun run --filter @avoid.quest/web typecheck
```

## Cloudflare deployment

Committed Wrangler config enables `workers_dev` and `preview_urls` for
workers.dev and Workers Builds preview exposure. Custom production hostnames
should be configured with Cloudflare account-level custom domains or routes
outside this repository.

Workers Builds PR comments should include the branch preview URL after upload.

Deployment scripts use the workspace-installed Wrangler version:

```bash
bun run --filter @avoid.quest/web cf-build
bun run --filter @avoid.quest/web cf-deploy
bun run --filter @avoid.quest/web cf-upload
```

Do not run deploy or upload commands unless deployment is explicitly requested.

## Connections

- **@avoid.quest/ui**: Branding and the shared legal page.
- **Local theme control**: [`ThemeToggle.astro`](src/components/ThemeToggle.astro).
