# web

Landing page for avoid.quest. Links to all apps.

## Features

- Homepage with branding and app links
- Theme support (dark/light mode)
- Static site generation

## Tech Stack

- Astro
- React (islands)
- Tailwind CSS v4
- Cloudflare Pages (deploy)

## Routes

- `/` - Landing page with links to instarip, radio, cwavasape

## Development

```bash
# From monorepo root
bun run dev --filter=@avoid.quest/web
```

## Connections

- **@avoid.quest/ui**: Logo component, buttons, theme toggle
