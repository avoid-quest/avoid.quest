# Instarip Rewrite Plan

## Overview
Rewrite instarip-web from scratch using **TanStack Start + React** to align with the radio app architecture. Rename to simply `instarip`. Keep Convex backend, use existing media proxy, leverage shared UI package.

---

## Target Features

### Core Pages
1. **Home Feed** (`/`) - Chronological grid with infinite scroll
2. **Post Detail** (`/p/[shortcode]`) - Fullscreen media viewer with sidebar
3. **User Profile** (`/u/[username]`) - All posts from specific user

### Search & Filtering
- **Caption text search** - Full-text search through captions
- **User filter** - Dropdown/autocomplete to filter by creator
- **Date range filter** - Presets (last week, month) + custom range
- **Location filter** - Future enhancement (requires schema changes)

### Enhanced Media Experience
- **Fullscreen gallery** - Lightbox with keyboard navigation (Esc, arrows)
- **Swipe gestures** - Mobile-friendly carousel/gallery navigation
- **Pinch-to-zoom** - Touch zoom for image detail viewing
- **Download button** - Save images/videos locally

### Technical
- **Public access** - No authentication required
- **Media proxy** - Use existing Convex HTTP endpoint (`/media?id=...`)
- **Cloudflare Workers** - Deploy via TanStack Start adapter

---

## Architecture

### Directory Structure
```
apps/instarip/
├── src/
│   ├── routes/
│   │   ├── __root.tsx          # Providers, layout, global styles
│   │   ├── index.tsx           # Home feed with infinite scroll
│   │   ├── p/
│   │   │   └── $shortcode.tsx  # Post detail page
│   │   ├── u/
│   │   │   └── $username.tsx   # User profile page
│   │   └── api/                # Server routes (if needed)
│   ├── components/
│   │   ├── feed/
│   │   │   ├── post-grid.tsx   # Infinite scroll grid
│   │   │   ├── post-card.tsx   # Individual post card
│   │   │   └── filters.tsx     # Search/filter controls
│   │   ├── media/
│   │   │   ├── media-viewer.tsx    # Main media display
│   │   │   ├── lightbox.tsx        # Fullscreen gallery
│   │   │   ├── carousel.tsx        # Swipeable carousel
│   │   │   └── video-player.tsx    # Video with controls
│   │   ├── post/
│   │   │   ├── post-detail.tsx     # Detail page layout
│   │   │   └── post-sidebar.tsx    # Caption + metadata
│   │   └── layout/
│   │       ├── header.tsx
│   │       └── footer.tsx
│   ├── lib/
│   │   ├── hooks/
│   │   │   ├── use-posts.ts        # TanStack Query for posts
│   │   │   ├── use-users.ts        # TanStack Query for users
│   │   │   ├── use-infinite-posts.ts
│   │   │   └── use-filters.ts      # Filter state management
│   │   ├── stores/
│   │   │   └── filter-store.ts     # TanStack Store for UI state
│   │   ├── utils/
│   │   │   ├── date.ts             # Date formatting
│   │   │   └── media.ts            # Media URL helpers
│   │   └── convex.ts               # Convex client setup
│   └── styles/
│       └── globals.css
├── app.config.ts                   # TanStack Start config
├── package.json
└── tsconfig.json
```

### State Management
- **TanStack Query** - Server state (posts, users, media)
- **TanStack Store** - UI state (filters, lightbox open, scroll position)
- **Convex** - Backend queries (keep existing, add search index)

### Key Dependencies
```json
{
  "@tanstack/react-start": "latest",
  "@tanstack/react-query": "^5",
  "@tanstack/react-store": "latest",
  "@tanstack/react-virtual": "latest",
  "convex": "existing",
  "@workspace/ui": "workspace:*",
  "embla-carousel-react": "existing in ui",
  "use-gesture": "for swipe/pinch",
  "photoswipe": "or similar for lightbox"
}
```

---

## Implementation Phases

### Phase 1: Project Setup
**Files to create:**
- `apps/instarip/package.json`
- `apps/instarip/app.config.ts`
- `apps/instarip/tsconfig.json`
- `apps/instarip/src/routes/__root.tsx`
- `apps/instarip/src/lib/convex.ts`

**Tasks:**
- [ ] Initialize TanStack Start project
- [ ] Configure Convex provider
- [ ] Set up shared UI imports
- [ ] Configure Cloudflare Workers adapter
- [ ] Add to workspace

### Phase 2: Core Pages (MVP)
**Files to create:**
- `src/routes/index.tsx` - Home feed
- `src/routes/p/$shortcode.tsx` - Post detail
- `src/routes/u/$username.tsx` - User profile
- `src/components/feed/post-grid.tsx`
- `src/components/feed/post-card.tsx`
- `src/components/media/media-viewer.tsx`
- `src/components/post/post-detail.tsx`
- `src/components/post/post-sidebar.tsx`
- `src/components/layout/header.tsx`

**Tasks:**
- [ ] Home page with basic post grid
- [ ] Post detail page with media + sidebar
- [ ] User profile page
- [ ] Header with navigation
- [ ] Basic responsive layout

### Phase 3: Enhanced Media
**Files to create:**
- `src/components/media/lightbox.tsx`
- `src/components/media/carousel.tsx`
- `src/components/media/video-player.tsx`

**Tasks:**
- [ ] Fullscreen lightbox with keyboard nav
- [ ] Swipeable carousel (embla + use-gesture)
- [ ] Pinch-to-zoom on images
- [ ] Download button for media
- [ ] Video player with controls

### Phase 4: Search & Filtering
**Backend changes needed:**
- Add search index to Convex posts table (caption full-text)

**Files to create:**
- `src/components/feed/filters.tsx`
- `src/lib/stores/filter-store.ts`
- `src/lib/hooks/use-filters.ts`

**Tasks:**
- [ ] Caption search input with debounce
- [ ] User filter dropdown (autocomplete)
- [ ] Date range picker (presets + custom)
- [ ] Filter state persistence (URL params)
- [ ] Update Convex queries to support filtering

### Phase 5: Infinite Scroll & Performance
**Files to create:**
- `src/lib/hooks/use-infinite-posts.ts`

**Tasks:**
- [ ] Infinite scroll with TanStack Virtual
- [ ] Virtualized grid for performance
- [ ] Skeleton loading states
- [ ] Image lazy loading
- [ ] Prefetch on hover

### Phase 6: Polish & Deploy
**Tasks:**
- [ ] SEO metadata (title, description, OG tags)
- [ ] Error boundaries and fallbacks
- [ ] 404 pages
- [ ] Loading states throughout
- [ ] Mobile responsive testing
- [ ] Deploy to Cloudflare Workers

---

## Backend Changes Required

### Convex Schema Updates
```typescript
// Add search index for captions
posts: defineTable({
  // existing fields...
})
  .index("by_timestamp", ["timestamp"])
  .searchIndex("search_caption", { searchField: "caption" })
```

### New/Modified Queries
```typescript
// Paginated posts with filters
api.posts.getPostsPaginated({
  cursor?: string,
  limit: number,
  search?: string,      // caption search
  userId?: Id<"users">, // filter by user
  startDate?: number,   // date range start
  endDate?: number,     // date range end
})

// Search posts by caption
api.posts.searchPosts({
  query: string,
  limit: number,
})
```

---

## UI Components to Use (from @workspace/ui)

| Component | Usage |
|-----------|-------|
| Card | Post cards in grid |
| Button | Actions, download, navigation |
| Carousel | Multi-image posts |
| Skeleton | Loading states |
| Dialog | Lightbox container |
| Input | Search input |
| Select | User filter dropdown |
| Popover | Date picker |
| ScrollArea | Scrollable content |

---

## Media Handling Strategy

### URLs
1. **Primary**: Use Convex media proxy (`/media?id=<media_item_id>`)
2. **Fallback**: Direct URLs if file_id not available
3. **Thumbnails**: Lower quality for grid, full quality for viewer

### Lightbox
- PhotoSwipe or similar library
- Keyboard navigation (Esc, left/right arrows)
- Swipe gestures on mobile
- Pinch-to-zoom touch support
- Share and download buttons

### Download
- Fetch blob from proxy endpoint
- Create download link with proper filename
- Support both images and videos

---

## Verification Plan

### Manual Testing
1. Navigate to home, verify posts load in grid
2. Scroll down, verify infinite scroll loads more
3. Use search, verify results filter correctly
4. Click post, verify detail page with media
5. Open lightbox, verify fullscreen + gestures
6. Download media, verify file saves correctly
7. Visit user profile, verify posts filtered
8. Test on mobile, verify responsive + touch

### Automated Testing
- Unit tests for date formatting utilities
- Integration tests for Convex queries
- E2E tests for critical user flows (optional)

---

## Notes

- **Location filtering**: Not currently available in schema. Would require fetching location from Instagram API and adding to posts table. Can be added as future enhancement.
- **Media migration**: System is transitioning from Instagram URLs to Telegram file_ids. New code should prefer file_id-based proxy.
- **Performance**: Use TanStack Virtual for grid to handle large datasets efficiently.
