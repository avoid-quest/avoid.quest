# instarip

Instagram post viewer - browse scraped IG content without an account.

## Features

- **Post browsing**: Grid view with infinite scroll
- **Media viewer**: Lightbox for images/videos, carousel support
- **Filters**: By user, date range, location, collaborators
- **Search**: Full-text search on captions
- **User pages**: View posts by Instagram username
- **Real-time**: Convex subscriptions for live updates
- **Media proxy**: Cloudflare-cached media serving

## Tech Stack

- TanStack Start (file-based routing, SSR)
- TanStack Router, React Query
- Convex (real-time database)
- React 19, TypeScript, Vite
- Tailwind CSS v4
- Cloudflare Workers (deploy)

## Routes

- `/` - Main feed with filters and infinite scroll
- `/p/$shortcode` - Single post detail view
- `/u/$username` - User profile with their posts

## Environment Variables

```bash
VITE_CONVEX_URL=https://your-deployment.convex.cloud
```

## Development

```bash
# From monorepo root
bun run dev --filter=@avoid.quest/instarip

# Or start with backend
bun run dev --filter=@avoid.quest/instarip --filter=@avoid.quest/backend
```

## Connections

- **@avoid.quest/backend**: Posts, users, media data via Convex
- **@avoid.quest/ui**: Shared components (cards, buttons, dialogs)
