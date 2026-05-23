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

## Connections

- **@avoid.quest/ui**: Logo, buttons, and theme controls.
- **@avoid.quest/config**: Shared TypeScript configuration.
