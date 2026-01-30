# InstaRip Rewrite Review Report

> **Date:** 2025-01-30
> **Reviewer:** Claude (subagent)
> **Status:** Multiple Issues Found

## Summary

The InstaRip migration from Next.js to TanStack Start is largely complete, with good architecture decisions. However, there are **7 TypeScript errors** blocking the build and several functional gaps that need addressing.

---

## Critical Issues (Build Blockers)

### 1. Type Mismatch: `userId` in `use-filters.ts`

**File:** `apps/instarip/src/lib/hooks/use-filters.ts:59`

**Problem:** The `userId` in filter state is stored as `string | null`, but the API expects `Id<"users">`.

```typescript
// Current (wrong):
userId: state.userId ?? undefined,  // string | undefined

// Expected:
userId: Id<"users"> | undefined
```

**Fix:** Either:
- A) Cast the userId when passing to the query: `userId: state.userId as Id<"users"> | undefined`
- B) Store the filter state userId as `Id<"users"> | null` (requires importing from Convex types)

### 2. Pagination Type Mismatch: `continueCursor`

**File:** `apps/instarip/src/lib/hooks/use-filters.ts:72`

**Problem:** The `getPaginated` query returns `continueCursor: string | null`, but `usePaginatedQuery` from convex-helpers expects `continueCursor: string`.

**Root Cause:** The backend validator explicitly allows null:
```typescript
// packages/backend/convex/api/posts.ts
continueCursor: v.union(v.string(), v.null())
```

**Fix:** Update the backend to match convex-helpers paginator expectations. The paginator convention is to use an empty string `""` for "no cursor" rather than `null`.

### 3. Missing Type Annotations in `filters.tsx`

**File:** `apps/instarip/src/components/feed/filters.tsx:80`

**Problem:** Parameter `user` implicitly has `any` type in the map callback.

**Fix:**
```typescript
{users?.map((user: { _id: string; username: string }) => (
```

### 4. Post Type Mismatch in `index.tsx`

**File:** `apps/instarip/src/routes/index.tsx:52`

**Problem:** The `results` from `useFilteredPosts` don't match the expected `Post` type.

**Root Cause:** The union of different result types (search, filtered, paginated) creates a complex type that TypeScript can't reconcile.

**Fix:** Define a unified return type in `useFilteredPosts` that explicitly matches the `Post` type expected by `PostGrid`.

### 5. Missing Type Annotations in `$shortcode.tsx`

**File:** `apps/instarip/src/routes/p/$shortcode.tsx:47, 61, 62`

**Problems:**
- `post.media_type` accessing object with any type
- `item` parameters in filter/map callbacks lack types

**Fix:** Add explicit type for the `post` variable or use type guards.

---

## Functional Issues

### 6. User Profile Page - Posts Not Loading

**File:** `apps/instarip/src/routes/u/$username.tsx`

**Problem:** The user profile page shows a placeholder message instead of actual posts:
```typescript
<p className="text-muted-foreground">
  User posts will be loaded here (requires backend query for posts by user)
</p>
```

**Missing:**
- A hook like `usePostsByUser(userId)` that calls an API endpoint
- The API endpoint `api.api.posts.getByUserId` or similar

**Backend Status:** The component has `getPostsByUserId` in `components/instarip/posts.ts`, but there's no wrapper in `api/posts.ts`.

**Fix Required:**
1. Add to `packages/backend/convex/api/posts.ts`:
```typescript
export const getByUserId = query({
  args: { userId: v.id("users"), limit: v.optional(v.number()) },
  handler: async (ctx, { userId, limit }) => {
    const posts = await ctx.runQuery(
      components.instarip.posts.getPostsByUserId,
      { userId }
    );
    // Apply limit in memory (component query returns all)
    const limited = posts.slice(0, limit ?? 50);
    return enrichPostsWithMedia(ctx, limited);
  },
});
```

2. Add hook in `apps/instarip/src/lib/hooks/use-posts.ts`:
```typescript
export function usePostsByUserId(userId: string, limit = 50) {
  return useQuery(api.api.posts.getByUserId, { userId, limit } as any);
}
```

3. Use it in the profile page.

### 7. Media Items API Potential Issue

**File:** `packages/backend/convex/api/media.ts`

**Potential Problem:** The `getByPostId` accepts `postId: v.string()` but passes it to a component function that expects `v.id("posts")`.

```typescript
// Current
args: { postId: v.string() },
handler: async (ctx, { postId }) => {
  return await ctx.runQuery(
    components.instarip.mediaItems.getMediaItemsByPostId,
    { postId },  // Passing string where Id<"posts"> is expected
  );
}
```

**Status:** May work at runtime due to Convex's ID handling, but is technically incorrect and could cause issues.

**Fix:** Change to `postId: v.id("posts")` or explicitly handle the type cast.

---

## Architecture Review

### ✅ What's Working Well

1. **Backend API Layer** - Clean separation between public API (`api/posts.ts`, `api/users.ts`) and component internals
2. **Media Proxy** - HTTP handler properly serves Telegram-hosted media with caching
3. **Filter Store** - TanStack Store implementation is clean and reactive
4. **Pagination** - Uses convex-helpers paginator correctly in components
5. **Cron Jobs** - Properly orchestrated with retry logic
6. **Lightbox** - Full-featured with zoom, swipe gestures, download

### ⚠️ Needs Attention

1. **Type Safety** - Several `as any` casts indicate type mismatches
2. **Filter State** - Uses `string` for userId instead of proper Convex Id type
3. **Pagination Return Types** - Inconsistent null handling between backend and frontend

---

## Recommended Fix Order

1. **Backend First** (no frontend changes needed):
   - Fix `continueCursor` return type in `api/posts.ts`
   - Add `getByUserId` endpoint

2. **Type Fixes** (quick wins):
   - Add explicit types in `filters.tsx`, `$shortcode.tsx`
   - Fix userId type casting in `use-filters.ts`

3. **User Profile** (feature completion):
   - Add `usePostsByUserId` hook
   - Update user profile page to show posts

---

## Files to Modify

| File | Changes Needed |
|------|----------------|
| `packages/backend/convex/api/posts.ts` | Fix `continueCursor` return type; add `getByUserId` |
| `apps/instarip/src/lib/hooks/use-filters.ts` | Cast `userId` to proper Id type |
| `apps/instarip/src/lib/hooks/use-posts.ts` | Add `usePostsByUserId` hook |
| `apps/instarip/src/components/feed/filters.tsx` | Add type annotation to map callback |
| `apps/instarip/src/routes/p/$shortcode.tsx` | Add type annotations |
| `apps/instarip/src/routes/u/$username.tsx` | Implement posts loading |
| `apps/instarip/src/routes/index.tsx` | May need explicit type for results |

---

## Type Check Output (for reference)

```
src/components/feed/filters.tsx(80,24): error TS7006: Parameter 'user' implicitly has an 'any' type.
src/lib/hooks/use-filters.ts(59,5): error TS2345: Argument of type... userId string not assignable to Id<"users">
src/lib/hooks/use-filters.ts(72,5): error TS2345: Argument of type... continueCursor null not assignable to string
src/routes/index.tsx(52,39): error TS2322: Type... missing properties from type 'Post'
src/routes/p/$shortcode.tsx(47,25): error TS7053: Element implicitly has 'any' type
src/routes/p/$shortcode.tsx(61,14): error TS7006: Parameter 'item' implicitly has an 'any' type
src/routes/p/$shortcode.tsx(62,11): error TS7006: Parameter 'item' implicitly has an 'any' type
```
