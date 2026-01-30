# Instarip Data Model Enhancement Plan

**Status:** Planning  
**Created:** 2025-01-30  
**Goal:** Add location and collab support to the data model and frontend

---

## Context

Based on Instagram API audit:
- **Location**: Simple structure (`id`, `name`, `slug`), 78% usage on local accounts
- **Collabs**: Array of co-authors (`id`, `username`, `is_verified`), 38-63% of posts
- **Event date**: Keep as future feature (caption/image extraction) - no changes needed now

---

## Phase 1: Schema Changes

### Task 1.1: Update Posts Schema
**File:** `packages/backend/convex/components/instarip/schema.ts`

Add to `posts` table:
```typescript
// Location data (optional - null if post has no location)
location: v.optional(v.object({
  ig_id: v.string(),      // Instagram location ID
  name: v.string(),       // Human readable name
  slug: v.string(),       // URL-friendly slug
})),

// Collaborators (empty array if none)
collaborators: v.array(v.string()),  // Array of usernames
```

**Decision point:** Store collaborators as:
- A) Array of usernames (simple, denormalized) ✓ Recommended
- B) Array of user IDs (requires users to exist in our DB)
- C) Array of objects with full data (bloat)

**Recommendation:** Option A - just usernames. Simple, searchable, doesn't require collab users to be tracked.

### Task 1.2: Add Indexes (if needed)
```typescript
.index("by_location_id", ["location.ig_id"])  // Optional: filter by location
```

**Note:** Convex doesn't support array field indexes directly. For collab filtering, we'd use search or filter in queries.

---

## Phase 2: Adapter/Fetcher Updates

### Task 2.1: Update FetchedPost Type
**File:** `packages/backend/convex/components/instarip/adapter.ts`

Update `fetchedPostValidator`:
```typescript
location: v.optional(v.object({
  ig_id: v.string(),
  name: v.string(),
  slug: v.string(),
})),
collaborators: v.array(v.string()),
```

### Task 2.2: Update parseMediaNode Function
**File:** `packages/backend/convex/components/instarip/adapter.ts`

Extract location and collabs from Instagram response:
```typescript
// In parseMediaNode():
const location = node.location ? {
  ig_id: node.location.id,
  name: node.location.name,
  slug: node.location.slug,
} : undefined;

const collaborators = (node.coauthor_producers || [])
  .map((c: any) => c.username)
  .filter(Boolean);
```

---

## Phase 3: API Updates

### Task 3.1: Update Posts API
**File:** `packages/backend/convex/api/posts.ts`

Ensure `create`/`upsert` mutations accept new fields.

### Task 3.2: Update Query Returns
Ensure location and collaborators are returned in list/get queries.

---

## Phase 4: Frontend Updates

### Task 4.1: Update Post Types
**File:** `apps/instarip/src/lib/hooks/use-posts.ts` (or types file)

Add TypeScript types for location and collaborators.

### Task 4.2: Update PostCard Component
**File:** `apps/instarip/src/components/feed/post-card.tsx`

Display:
- 📍 Location name (if present)
- 👥 Collaborators (if present) - e.g., "with @username, @username2"

### Task 4.3: Update Filters (Optional)
**File:** `apps/instarip/src/components/feed/filters.tsx`

Consider adding:
- Filter by location (dropdown of known locations)
- Filter by collaborator

**Note:** This may be out of scope for initial implementation.

---

## Phase 5: Telegram Integration

### Task 5.1: Update Message Formatting
**File:** `packages/backend/convex/components/telegram/sender.ts` (or formatting logic)

Include in Telegram message:
```
📍 Fontana Di Trevi
👥 with @turismoromaweb, @museiincomuneroma
```

---

## Phase 6: Migration (if needed)

### Task 6.1: Backfill Existing Posts
If we have existing posts without location/collabs:
- Option A: Leave as null/empty (recommended - they'll update on next fetch)
- Option B: Re-fetch all posts to populate (expensive, may hit rate limits)

**Recommendation:** Option A - new fields are optional, old posts stay as-is.

---

## Implementation Order

1. **Phase 1** - Schema (foundation)
2. **Phase 2** - Adapter (data extraction)
3. **Phase 3** - API (wire it up)
4. **Phase 4** - Frontend (display)
5. **Phase 5** - Telegram (optional, can defer)
6. **Phase 6** - Migration (likely skip)

---

## Estimated Effort

| Phase | Tasks | Estimate |
|-------|-------|----------|
| 1. Schema | 2 | 15 min |
| 2. Adapter | 2 | 20 min |
| 3. API | 2 | 10 min |
| 4. Frontend | 3 | 30 min |
| 5. Telegram | 1 | 15 min |
| 6. Migration | 1 | Skip |

**Total:** ~1.5 hours

---

## Open Questions

1. **Collab user auto-discovery:** Should we automatically add collab usernames to our users table for future tracking? (Probably not - keep it simple)

2. **Location linking:** Should clicking a location filter posts by that location? (Nice to have, not MVP)

3. **Telegram format:** How verbose should location/collab info be in Telegram messages?

---

## Files to Modify

```
packages/backend/convex/components/instarip/
├── schema.ts           # Phase 1
├── adapter.ts          # Phase 2
└── (posts.ts if separate)

packages/backend/convex/api/
└── posts.ts            # Phase 3

apps/instarip/src/
├── lib/hooks/use-posts.ts    # Phase 4
└── components/feed/
    ├── post-card.tsx         # Phase 4
    └── filters.tsx           # Phase 4 (optional)

packages/backend/convex/components/telegram/
└── sender.ts           # Phase 5
```

---

## Acceptance Criteria

- [ ] Posts table supports location (optional object) and collaborators (string array)
- [ ] Instagram fetcher extracts and stores location/collab data
- [ ] Frontend displays location and collaborators on post cards
- [ ] Existing posts without data continue to work (backward compatible)
- [ ] No breaking changes to existing API consumers
