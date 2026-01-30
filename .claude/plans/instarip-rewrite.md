# Instarip Rewrite Plan

> **Last Updated:** 2026-01-30
> **Status:** Ready for Phase 1
> **Branch:** `refactor/instarip-migration`

## Overview

Rewrite instarip from Next.js to **TanStack Start + React** to align with the radio app architecture. Delete existing Next.js app, start fresh. Keep Convex backend (already componentized), use existing media proxy, leverage shared UI package.

**Reference Implementation:** `apps/radio/` — copy structure and config patterns from here.

---

## Pre-Migration Setup ✅

- [x] Skills created (`.claude/skills/`)
  - `convex-expert/` — Convex coding rules + project patterns
  - `tanstack-mcp/` — TanStack MCP tool reference
  - `context7-mcp/` — Context7 MCP tool reference
- [x] MCP servers configured (user scope)
  - `tanstack` — TanStack docs + project creation
  - `context7` — Any other library docs
- [x] `.claude/CLAUDE.md` updated with auto-invoke rules

---

## Target Features

### Core Pages
1. **Home Feed** (`/`) — Chronological grid with infinite scroll
2. **Post Detail** (`/p/$shortcode`) — Fullscreen media viewer with sidebar
3. **User Profile** (`/u/$username`) — All posts from specific user

### Search & Filtering
- **Caption text search** — Full-text search through captions
- **User filter** — Dropdown/autocomplete to filter by creator
- **Date range filter** — Presets (last week, month) + custom range

### Enhanced Media Experience
- **Fullscreen gallery** — Lightbox with keyboard navigation (Esc, arrows)
- **Swipe gestures** — Mobile-friendly carousel/gallery navigation
- **Pinch-to-zoom** — Touch zoom for image detail viewing
- **Download button** — Save images/videos locally

### Technical
- **Public access** — No authentication required
- **Media proxy** — Use existing Convex HTTP endpoint (`/media?id=...`)
- **Cloudflare Workers** — Deploy via `@cloudflare/vite-plugin`

---

## Architecture

### Directory Structure (matches radio app)

```
apps/instarip/
├── src/
│   ├── routes/
│   │   ├── __root.tsx          # Providers, layout, global styles
│   │   ├── index.tsx           # Home feed with infinite scroll
│   │   ├── p/
│   │   │   └── $shortcode.tsx  # Post detail page
│   │   └── u/
│   │       └── $username.tsx   # User profile page
│   ├── components/
│   │   ├── feed/
│   │   │   ├── post-grid.tsx
│   │   │   ├── post-card.tsx
│   │   │   └── filters.tsx
│   │   ├── media/
│   │   │   ├── media-viewer.tsx
│   │   │   ├── lightbox.tsx
│   │   │   ├── carousel.tsx
│   │   │   └── video-player.tsx
│   │   ├── post/
│   │   │   ├── post-detail.tsx
│   │   │   └── post-sidebar.tsx
│   │   └── layout/
│   │       └── header.tsx
│   ├── lib/
│   │   ├── hooks/
│   │   │   ├── use-posts.ts
│   │   │   ├── use-users.ts
│   │   │   └── use-filters.ts
│   │   ├── stores/
│   │   │   └── filter-store.ts
│   │   └── utils/
│   │       ├── date.ts
│   │       └── media.ts
│   └── styles/
│       └── globals.css
├── vite.config.ts              # TanStack Start + Cloudflare config
├── wrangler.jsonc              # Cloudflare Workers config
├── package.json
└── tsconfig.json
```

### Key Dependencies (from radio app)

```json
{
  "@cloudflare/vite-plugin": "^1.21.2",
  "@tailwindcss/vite": "catalog:",
  "@tanstack/react-query": "^5.90.19",
  "@tanstack/react-router": "^1.154.7",
  "@tanstack/react-start": "^1.154.7",
  "@tanstack/react-store": "^0.8.0",
  "@tanstack/react-virtual": "catalog:",
  "@tanstack/router-plugin": "^1.154.7",
  "@avoid.quest/backend": "workspace:*",
  "@avoid.quest/ui": "workspace:*",
  "convex": "catalog:",
  "lucide-react": "catalog:",
  "next-themes": "catalog:",
  "react": "catalog:",
  "react-dom": "catalog:",
  "sonner": "catalog:",
  "tailwindcss": "catalog:",
  "vite-tsconfig-paths": "^6.0.4",
  "zod": "catalog:"
}
```

### Vite Config Pattern (from radio app)

```typescript
// vite.config.ts
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tailwindcss(),
    tsConfigPaths(),
    tanstackStart(),
    viteReact(),
  ],
  build: {
    minify: "esbuild",
    sourcemap: false,
  },
});
```

---

## Implementation Phases

### Phase 1: Project Setup
**Goal:** Fresh TanStack Start app that builds and deploys

**Tasks:**
- [ ] Create branch `refactor/instarip-migration`
- [ ] Delete `apps/instarip/` (entire Next.js app)
- [ ] Create new `apps/instarip/` with TanStack Start structure
- [ ] Copy vite.config.ts pattern from radio
- [ ] Set up wrangler.jsonc for Cloudflare Workers
- [ ] Configure Convex client (ConvexProvider)
- [ ] Set up shared UI imports (@avoid.quest/ui)
- [ ] Add Tailwind v4 config
- [ ] Create minimal `__root.tsx` with providers
- [ ] Create placeholder `index.tsx` route
- [ ] Verify `bun run dev` works
- [ ] Verify `bun run build` succeeds

**Deliverables:**
- Working dev server at localhost:3000
- Successful build output
- Basic "Hello World" page with theme support

### Phase 2: Core Pages (MVP)
**Goal:** Functional feed, post detail, and user profile pages

**Tasks:**
- [ ] Home feed with post grid (using existing `getPostsPaginated`)
- [ ] Post card component (image/video thumbnail)
- [ ] Post detail page (`/p/$shortcode`)
- [ ] User profile page (`/u/$username`)
- [ ] Header with navigation
- [ ] Basic responsive layout
- [ ] Loading states (Skeleton)

**Backend:** No changes needed — use existing component queries:
- `components.instarip.posts.getPostsPaginated`
- `components.instarip.posts.getPostByShortcode`
- `components.instarip.users.getUserByUsername`
- `components.instarip.mediaItems.getMediaItemsByPostId`

### Phase 3: Enhanced Media
**Goal:** Rich media experience with lightbox and gestures

**Tasks:**
- [ ] Media viewer component (handles image/video/carousel)
- [ ] Fullscreen lightbox with Dialog
- [ ] Keyboard navigation (Esc, arrows)
- [ ] Swipeable carousel (embla-carousel from UI package)
- [ ] Pinch-to-zoom on images
- [ ] Download button for media
- [ ] Video player with controls

### Phase 4: Search & Filtering
**Goal:** Find posts by caption, user, or date

**Backend changes (in `components/instarip/`):**
- [ ] Add search index to posts schema: `.searchIndex("search_caption", { searchField: "caption" })`
- [ ] Add `searchPosts` query using `withSearchIndex`
- [ ] Extend `getPostsPaginated` with optional filters (userId, dateRange)

**Frontend:**
- [ ] Filter bar component
- [ ] Caption search input with debounce
- [ ] User filter dropdown (autocomplete)
- [ ] Date range picker (presets + custom)
- [ ] URL param persistence for filters
- [ ] TanStack Store for filter state

### Phase 5: Infinite Scroll & Performance
**Goal:** Smooth scrolling with large datasets

**Tasks:**
- [ ] Infinite scroll with TanStack Virtual
- [ ] Virtualized grid for performance
- [ ] Skeleton loading states
- [ ] Image lazy loading
- [ ] Prefetch on hover

### Phase 6: Polish & Deploy
**Goal:** Production-ready app

**Tasks:**
- [ ] SEO metadata (title, description, OG tags)
- [ ] Error boundaries and fallbacks
- [ ] 404 page
- [ ] Loading states throughout
- [ ] Mobile responsive testing
- [ ] Deploy to Cloudflare Workers (reuse existing worker)

**Cloudflare Dashboard:**
- Update worker to point to new build output
- No config changes needed if reusing existing setup

---

## Backend Component Structure (Current)

The backend is already componentized. **Do not restructure** — use existing patterns:

```
packages/backend/convex/
├── components/
│   └── instarip/           # All instarip data
│       ├── posts.ts        # getPostsPaginated, getPostByShortcode, etc.
│       ├── users.ts        # getUserByUsername, etc.
│       ├── mediaItems.ts   # getMediaItemsByPostId
│       ├── settings.ts     # App settings
│       ├── fetcher.ts      # Instagram fetching
│       └── schema.ts       # Component schema
├── instarip/               # Telegram bot (separate from web app)
└── http.ts                 # /media proxy endpoint
```

**Accessing from frontend:**
```typescript
import { components } from "@avoid.quest/backend/convex/_generated/api";

// In TanStack Query or loader
const posts = await convex.query(components.instarip.posts.getPostsPaginated, {
  paginationOpts: { numItems: 20, cursor: null }
});
```

---

## UI Components from @avoid.quest/ui

| Component | Usage |
|-----------|-------|
| Card | Post cards in grid |
| Button | Actions, download, navigation |
| Carousel | Multi-image posts (embla-carousel) |
| Skeleton | Loading states |
| Dialog | Lightbox container |
| Input | Search input |
| Select | User filter dropdown |
| Popover | Date picker |
| ScrollArea | Scrollable content |

---

## Media Handling

### URLs
1. **Primary:** Convex media proxy (`https://<deployment>.convex.site/media?id=<media_item_id>`)
2. **Fallback:** Direct Instagram URLs if `telegram_file` not available

### Media Item Structure
```typescript
{
  _id: Id<"media_items">,
  post_id: Id<"posts">,
  type: "image" | "video" | "thumbnail",
  telegram_file?: {
    file_id: string,
    file_unique_id: string,
  },
  width?: number,
  height?: number,
}
```

---

## Verification Checklist

### Per-Phase
- [ ] `bun run dev` works
- [ ] `bun run build` succeeds
- [ ] `bun run check` passes (types + lint)
- [ ] Manual smoke test of new features

### Final
- [ ] All routes work (/, /p/$shortcode, /u/$username)
- [ ] Infinite scroll loads more posts
- [ ] Search/filters work correctly
- [ ] Lightbox opens and navigates
- [ ] Download works for images/videos
- [ ] Mobile responsive
- [ ] Deployed to Cloudflare Workers

---

## Notes

- **Reference radio app** for patterns — it's the canonical TanStack Start implementation
- **Use TanStack MCP** for up-to-date Router/Start docs
- **Use Context7 MCP** for other library docs (React, Tailwind, etc.)
- **Read convex-expert skill** before writing backend code
- **Timestamps in MILLISECONDS** — match existing backend convention
