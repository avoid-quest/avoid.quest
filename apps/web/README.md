# web

Astro landing page for avoid.quest.

## Features

- Homepage with avoid.quest branding and links to active apps.
- Theme support through shared UI components.
- Static-first Astro app deployed through Cloudflare.

## Tech stack

- Astro
- React islands
- Tailwind CSS v4
- Cloudflare Workers/Pages-compatible build

## Routes

- `/` - Landing page with active avoid.quest links.

## Development

```bash
# From the repository root
bun run --filter @avoid.quest/web dev
bun run --filter @avoid.quest/web build
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

- **@avoid.quest/ui**: Logo, buttons, and theme controls.
- **@avoid.quest/config**: Shared TypeScript configuration.
