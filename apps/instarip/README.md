# instarip

Instagram post viewer.

## Features

- Feed view: grid layout of all posts, virtual scrolling
- Post detail pages: full-size media with captions, supports images/videos/carousels
- User pages: filter posts by username, profile metadata
- Media types: single images, videos, carousel posts with multiple items
- Real-time updates: Convex reactive queries auto-refresh on new posts
- Responsive design: works on mobile/desktop

## Connections

- Uses `@workspace/backend` (Convex): posts/users/media_items queries
- Uses `@workspace/ui`: shared component library (cards, buttons, carousel)
- Deploy: Cloudflare Pages via OpenNext
